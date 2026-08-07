"""
47_build_streets.py -- Phase 2E: street network and sidewalk geometry.

Runs on system Python. Turns two NYC datasets into something Blender and the
Three.js runtime can both consume:

  inkn-q76z  Centerline   14,023 Manhattan segments with lane counts,
                          direction of travel, posted speed and carriageway
                          width. This is the road graph.
  52n9-sdep  Planimetric  11,092 sidewalk polygons -- the real kerb line,
             Sidewalk     surveyed, including every corner radius.

Phase 1 drew roads from OSM ways with a guessed width and no sidewalk at all,
which is why street level reads as a flat grey plane. LION knows how wide
every carriageway actually is and which way the traffic runs; the planimetric
sidewalk knows exactly where the kerb is.

Outputs (data/manhattan/streets/):
  street_graph.json     nodes + edges for the traffic system: lanes, oneway,
                        speed, class, length, and the polyline for each edge
  street_geom.json      per-segment polylines in local metres, for Blender
  sidewalk_geom.json    simplified sidewalk rings in local metres
  docs/phase2/STREET_REPORT.json

Usage:  python scripts/phase2/47_build_streets.py
"""

import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nta  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NYC = os.path.join(ROOT, "source_data", "nyc")
OUT = os.path.join(ROOT, "data", "manhattan", "streets")
DOCS = os.path.join(ROOT, "docs", "phase2")

# same local tangent plane as everything else in the project
LAT0 = 40.7800
LON0 = -73.9680
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))

FT = 0.3048

# LION roadway types. The ones that carry vehicles get asphalt and lanes; the
# ones that carry people get a path; the rest are not physical objects.
RW_TYPE = {
    "1": ("street", True),
    "2": ("highway", True),
    "3": ("bridge", True),
    "4": ("tunnel", True),
    "5": ("boardwalk", False),
    "6": ("path", False),
    "7": ("alley", True),
    "8": ("non_physical", None),     # centreline of a plaza, no pavement
    "9": ("ferry", None),
    "10": ("uturn", True),
    "11": ("ramp", True),
    "12": ("interchange", True),
    "13": ("step_street", False),
    "14": ("driveway", True),
    "15": ("private_road", True),
}

# snap tolerance for deciding two segment ends are the same intersection
SNAP = 3.0

# Douglas-Peucker tolerance for sidewalk rings. The kerb radius at a corner is
# about 3 m, so anything above ~0.4 m starts eating the corners.
SIMPLIFY = 0.35

# rings smaller than this are survey slivers, not sidewalk
MIN_RING_AREA = 6.0


def ll2xy(lon, lat):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def ring_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def dp(pts, tol):
    """Douglas-Peucker. Iterative so a 20k-vertex ring cannot blow the stack."""
    if len(pts) < 3:
        return pts[:]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    t2 = tol * tol
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        best = -1.0
        bi = -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if dd < 1e-12:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / dd
                t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
                qx, qy = ax + t * dx, ay + t * dy
                d2 = (px - qx) ** 2 + (py - qy) ** 2
            if d2 > best:
                best, bi = d2, k
        if best > t2:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


# ---------------------------------------------------------------------------
# centerlines -> road graph
# ---------------------------------------------------------------------------
def build_graph():
    path = os.path.join(NYC, "centerline.json")
    if not os.path.exists(path):
        print("missing centerline.json -- run 40_fetch_nyc_open_data.py "
              "--only centerline")
        return None, None, None
    raw = json.load(open(path, encoding="utf-8"))

    nodes = {}          # snapped key -> node index
    node_xy = []
    edges = []
    stats = Counter()
    kinds = Counter()

    def node_at(x, y):
        k = (int(round(x / SNAP)), int(round(y / SNAP)))
        i = nodes.get(k)
        if i is None:
            i = len(node_xy)
            nodes[k] = i
            node_xy.append([round(x, 2), round(y, 2)])
        return i

    for r in raw:
        g = r.get("the_geom") or {}
        if g.get("type") == "LineString":
            lines = [g["coordinates"]]
        elif g.get("type") == "MultiLineString":
            lines = g["coordinates"]
        else:
            stats["no_geometry"] += 1
            continue

        kind, drivable = RW_TYPE.get(str(r.get("rw_type") or ""),
                                     ("unknown", True))
        kinds[kind] += 1
        if drivable is None:
            stats["skip_non_physical"] += 1
            continue

        width_ft = num(r.get("streetwidth"))
        lanes = int(num(r.get("number_travel_lanes")))
        park = int(num(r.get("number_park_lanes")))
        speed = int(num(r.get("posted_speed")))
        trafdir = (r.get("trafdir") or "").strip().upper()

        # LION leaves width blank on about 17% of segments. Fall back to the
        # lane count, not to a constant: a 1-lane alley and a 4-lane avenue
        # are both "unknown" and must not come out the same width.
        if width_ft <= 0:
            total = lanes + park
            width_ft = (total * 10.0 + 4.0) if total else 26.0
            stats["width_estimated"] += 1
        width = width_ft * FT

        if not lanes:
            lanes = 1 if not drivable else max(1, int(round(width / 3.4)) - park)
            stats["lanes_estimated"] += 1
        if not speed:
            speed = 25 if kind == "street" else (40 if kind == "highway" else 15)
            stats["speed_estimated"] += 1

        for coords in lines:
            pts = [ll2xy(float(c[0]), float(c[1])) for c in coords]
            if len(pts) < 2:
                continue
            # LION geometry is already clean; only drop exact duplicates
            clean = [pts[0]]
            for p in pts[1:]:
                if abs(p[0] - clean[-1][0]) > 0.01 or \
                        abs(p[1] - clean[-1][1]) > 0.01:
                    clean.append(p)
            if len(clean) < 2:
                continue

            length = sum(math.dist(clean[i], clean[i + 1])
                         for i in range(len(clean) - 1))
            if length < 1.0:
                stats["skip_tiny"] += 1
                continue

            a = node_at(*clean[0])
            b = node_at(*clean[-1])
            if a == b and length < SNAP * 2:
                stats["skip_selfloop"] += 1
                continue

            # trafdir: FT one-way along the geometry, TF one-way against it,
            # TW two-way, NV non-vehicular
            if trafdir == "FT":
                oneway = 1
            elif trafdir == "TF":
                oneway = -1
            elif trafdir == "TW":
                oneway = 0
            else:
                oneway = 0
                drivable = False

            edges.append({
                "id": len(edges),
                "pid": int(num(r.get("physicalid"))),
                "a": a, "b": b,
                "name": (r.get("stname_label") or
                         r.get("full_street_name") or "").strip(),
                "kind": kind,
                "drivable": bool(drivable),
                "width": round(width, 2),
                "lanes": lanes,
                "park_lanes": park,
                "oneway": oneway,
                "speed_mph": speed,
                "length": round(length, 2),
                "pts": [[round(x, 2), round(y, 2)] for x, y in clean],
            })
            stats["edges"] += 1

    # degree, so the runtime can find intersections without recomputing
    deg = Counter()
    for e in edges:
        deg[e["a"]] += 1
        deg[e["b"]] += 1

    graph = {
        "generated_by": "scripts/phase2/47_build_streets.py",
        "source": "NYC Open Data inkn-q76z Centerline",
        "projection": {"lat0": LAT0, "lon0": LON0, "units": "metres"},
        "snap_m": SNAP,
        "nodes": node_xy,
        "node_degree": [deg.get(i, 0) for i in range(len(node_xy))],
        "edges": edges,
    }
    return graph, stats, kinds


# ---------------------------------------------------------------------------
# planimetric sidewalk -> rings
# ---------------------------------------------------------------------------
def build_sidewalks():
    path = os.path.join(NYC, "sidewalk.json")
    if not os.path.exists(path):
        print("missing sidewalk.json -- run 40_fetch_nyc_open_data.py "
              "--only sidewalk")
        return None, None
    raw = json.load(open(path, encoding="utf-8"))

    # The fetch used a bounding box, and a box around Manhattan also contains
    # Long Island City, Williamsburg, Hoboken and half the south Bronx. Test
    # against the city's own borough polygons instead: a box filter left
    # 74 km2 of sidewalk in a 59 km2 borough.
    ntas = nta.load()
    if not ntas:
        print("missing nta.json -- run 40_fetch_nyc_open_data.py --only nta")
        return None, None
    hint = [None]

    def on_island(lon, lat):
        hit = nta.find(lon, lat, ntas, hint[0])
        if hit is not None:
            hint[0] = hit
        return hit is not None

    polys = []
    stats = Counter()
    vin = vout = 0

    for r in raw:
        g = r.get("the_geom") or {}
        if g.get("type") == "Polygon":
            plist = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            plist = g["coordinates"]
        else:
            continue

        for poly in plist:
            # test the outer ring's first vertex before doing any projection
            # or simplification work on a polygon in another borough
            outer = poly[0] if poly else None
            if not outer or len(outer) < 3:
                continue
            mid = outer[len(outer) // 2]
            if not (on_island(float(outer[0][0]), float(outer[0][1])) or
                    on_island(float(mid[0]), float(mid[1]))):
                stats["outside_island"] += 1
                continue

            rings = []
            for ri, ring in enumerate(poly):
                pts = [ll2xy(float(c[0]), float(c[1])) for c in ring]
                if len(pts) > 2 and pts[0] == pts[-1]:
                    pts = pts[:-1]
                vin += len(pts)
                if len(pts) < 3:
                    continue
                simple = dp(pts + [pts[0]], SIMPLIFY)[:-1]
                if len(simple) < 3:
                    continue
                a = abs(ring_area(simple))
                if a < MIN_RING_AREA:
                    stats["ring_too_small"] += 1
                    continue
                vout += len(simple)
                rings.append({"outer": ri == 0,
                              "area": round(a, 1),
                              "pts": [[round(px, 2), round(py, 2)]
                                      for px, py in simple]})
            if not rings or not rings[0]["outer"]:
                continue
            polys.append(rings)
            stats["polygons"] += 1

    stats["verts_in"] = vin
    stats["verts_out"] = vout
    return polys, stats


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)

    print("=" * 74)
    print("PHASE 2E  STREET NETWORK + SIDEWALKS")
    print("=" * 74)

    graph, gstats, kinds = build_graph()
    if graph is None:
        return 2

    sidewalks, sstats = build_sidewalks()
    if sidewalks is None:
        return 2

    with open(os.path.join(OUT, "street_graph.json"), "w",
              encoding="utf-8") as f:
        json.dump(graph, f, separators=(",", ":"))
    with open(os.path.join(OUT, "sidewalk_geom.json"), "w",
              encoding="utf-8") as f:
        json.dump({"projection": graph["projection"],
                   "simplify_m": SIMPLIFY,
                   "source": "NYC Open Data 52n9-sdep Planimetric Sidewalk",
                   "polygons": sidewalks}, f, separators=(",", ":"))

    drivable = [e for e in graph["edges"] if e["drivable"]]
    total_km = sum(e["length"] for e in graph["edges"]) / 1000.0
    drive_km = sum(e["length"] for e in drivable) / 1000.0
    inter = sum(1 for d in graph["node_degree"] if d >= 3)
    # A sidewalk polygon is a ring: the outer contour follows the building
    # line and the holes are the block interiors and roadways. Summing outer
    # rings alone counts every block interior as pavement and gives 34 km2 of
    # sidewalk in a 59 km2 borough.
    sw_area = 0.0
    sw_holes = 0
    for poly in sidewalks:
        for r in poly:
            if r["outer"]:
                sw_area += r["area"]
            else:
                sw_area -= r["area"]
                sw_holes += 1

    report = {
        "centerline_segments": len(graph["edges"]),
        "drivable_segments": len(drivable),
        "nodes": len(graph["nodes"]),
        "intersections_deg3plus": inter,
        "network_km": round(total_km, 1),
        "drivable_km": round(drive_km, 1),
        "by_kind": dict(kinds.most_common()),
        "oneway": {
            "forward": sum(1 for e in drivable if e["oneway"] == 1),
            "backward": sum(1 for e in drivable if e["oneway"] == -1),
            "two_way": sum(1 for e in drivable if e["oneway"] == 0),
        },
        "estimated_fields": {
            "width": gstats["width_estimated"],
            "lanes": gstats["lanes_estimated"],
            "speed": gstats["speed_estimated"],
        },
        "skipped": {k: v for k, v in gstats.items() if k.startswith("skip")},
        "sidewalk_polygons": sstats["polygons"],
        "sidewalk_holes": sw_holes,
        "sidewalk_net_area_m2": round(sw_area),
        "sidewalk_verts_in": sstats["verts_in"],
        "sidewalk_verts_out": sstats["verts_out"],
        "sidewalk_reduction": round(
            1.0 - sstats["verts_out"] / max(1, sstats["verts_in"]), 3),
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "STREET_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("  centerline segments  : %d  (%d drivable)"
          % (len(graph["edges"]), len(drivable)))
    print("  graph nodes          : %d  (%d are junctions)"
          % (len(graph["nodes"]), inter))
    print("  network length       : %.1f km  (%.1f km drivable)"
          % (total_km, drive_km))
    print("  one-way fwd/back/two : %d / %d / %d"
          % (report["oneway"]["forward"], report["oneway"]["backward"],
             report["oneway"]["two_way"]))
    print("-" * 74)
    print("  by roadway type:")
    for k, v in kinds.most_common():
        print("    %-14s %5d" % (k, v))
    print("-" * 74)
    print("  estimated width/lanes/speed: %d / %d / %d segments"
          % (gstats["width_estimated"], gstats["lanes_estimated"],
             gstats["speed_estimated"]))
    print("  sidewalk polygons    : %d with %d holes, %.2f km2 net pavement"
          % (sstats["polygons"], sw_holes, sw_area / 1e6))
    print("  sidewalk vertices    : %d -> %d  (%.0f%% removed)"
          % (sstats["verts_in"], sstats["verts_out"],
             100.0 * report["sidewalk_reduction"]))
    print("  -> %s" % os.path.relpath(OUT, ROOT))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
