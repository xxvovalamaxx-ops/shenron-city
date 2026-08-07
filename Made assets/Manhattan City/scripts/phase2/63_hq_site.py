"""
63_hq_site.py -- Phase 2L: choose the lot the HQ stands on, and prove it fits.

    python scripts/phase2/63_hq_site.py

62_hq.py authors the building. This decides where in Manhattan it goes, and
it does so from the registry rather than by picking a spot off a map, because
a hand-picked spot is a spot nobody checked.

The rules a site has to pass:

  * a real lot big enough to hold a 54 x 46 m footprint
  * already a tower, so the HQ is not a 244 m building dropped in a block of
    six-storey walk-ups
  * not a landmark. The brief freezes the Phase 1 world as geographic source
    of truth; replacing the Chrysler Building with a fictional headquarters
    would be exactly the misrepresentation it warns against
  * a drivable street frontage, since the hero corridor arrives by car
  * on the west side of Midtown, within driving distance of the market the
    corridor comes from

Then two things get measured rather than assumed:

  * how many registry buildings the footprint covers -- those are suppressed
    at runtime, and the count is reported instead of quietly swallowed
  * how close the podium comes to the nearest drivable centreline, so the
    building does not stand in the road

The yaw is computed here and emitted, not recomputed in the browser. The
suppression list is derived from the footprint at this yaw, so if the two ever
disagreed the runtime would hide the wrong buildings.
"""

import csv
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))          # scripts/phase2
ROOT = os.path.dirname(os.path.dirname(HERE))              # repo root
MANIFEST = os.path.join(ROOT, "exports", "building_manifest.csv")
GRAPH = os.path.join(ROOT, "data", "manhattan", "streets", "street_graph.json")
OUT_DIR = os.path.join(ROOT, "data", "manhattan", "hq")
DOCS = os.path.join(ROOT, "docs", "phase2")

# from 62_hq.py -- kept in one place by reading the report it writes
HQ_REPORT = os.path.join(DOCS, "HQ_REPORT.json")

DISTRICTS = {"Midtown West / Times Sq", "Midtown East", "Chelsea",
             "Hell's Kitchen / Clinton", "Garment District",
             "Hudson Yards / Chelsea"}
MIN_AREA = 2700.0        # the footprint is 2,484 m2; leave a margin
MIN_H = 45.0
MAX_H = 185.0            # above this it is somebody's landmark
CLASSES = {"highrise", "tower", "glass", "midrise"}


def load_manifest():
    rows = []
    with open(MANIFEST, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                rows.append({
                    "bid": int(r["bid"]),
                    "name": r["name"], "addr": r["addr"],
                    "district": r["district"], "cls": r["class"],
                    "h": float(r["height_m"] or 0.0),
                    "area": float(r["area_m2"] or 0.0),
                    "x": float(r["x_m"]), "y": float(r["y_m"]),
                    "context": r["is_context"] == "1",
                })
            except (ValueError, KeyError):
                continue
    return rows


def nearest_street(edges, x, y, limit=220.0):
    """Closest point on the closest drivable segment, and its width.

    The obvious version takes each segment's midpoint, and it is wrong for the
    same reason picking an LOD tier by distance to the tile centre was wrong:
    a long segment running past the front door has its midpoint half a block
    away, so a building on 42nd Street comes back facing 41st. Project onto
    the segment instead."""
    best, bd = None, limit
    for e in edges:
        if not e.get("drivable"):
            continue
        p = e["pts"]
        for i in range(len(p) - 1):
            ax, ay = p[i]
            bx, by = p[i + 1]
            vx, vy = bx - ax, by - ay
            L2 = vx * vx + vy * vy
            t = 0.0 if L2 <= 1e-9 else max(0.0, min(
                1.0, ((x - ax) * vx + (y - ay) * vy) / L2))
            cx, cy = ax + vx * t, ay + vy * t
            d = math.hypot(x - cx, y - cy)
            if d < bd:
                bd = d
                best = (cx, cy, e.get("width", 12.0), e.get("name", ""))
    return best


def seg_point_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0,
                                            ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + vx * t), py - (ay + vy * t))


def rect_seg_clearance(corners, ax, ay, bx, by):
    """Distance from a convex rectangle to a segment. Zero if they cross."""
    # segment endpoints against the rectangle's edges, and rectangle corners
    # against the segment -- for two convex shapes that is the full test
    d = min(seg_point_dist(cx, cy, ax, ay, bx, by) for cx, cy in corners)
    for i in range(4):
        cx, cy = corners[i]
        nx, ny = corners[(i + 1) % 4]
        d = min(d, seg_point_dist(ax, ay, cx, cy, nx, ny),
                seg_point_dist(bx, by, cx, cy, nx, ny))
    return d


def main():
    spec = json.load(open(HQ_REPORT))
    lot_w = spec["tower"]["lot_width_m"]
    lot_d = spec["tower"]["lot_depth_m"]
    plaza = spec["tower"]["plaza_depth_m"]

    rows = load_manifest()
    graph = json.load(open(GRAPH))
    edges = graph["edges"]

    print("=" * 74)
    print("PHASE 2L  HQ SITE")
    print("=" * 74)
    print("  footprint %.0f x %.0f m, %.0f m of it plaza" % (lot_w, lot_d, plaza))

    cand = [r for r in rows
            if not r["context"]
            and r["district"] in DISTRICTS
            and r["cls"] in CLASSES
            and MIN_H <= r["h"] <= MAX_H
            and r["area"] >= MIN_AREA]
    print("  %d candidate lots out of %d buildings" % (len(cand), len(rows)))
    if not cand:
        raise SystemExit("no candidate site")

    # Score: a big lot and a tall neighbour are both good, and so is being
    # close to the market the hero corridor leaves from.
    # An anonymous lot is worth more than a good-looking one. The frozen
    # world is the geographic source of truth and the HQ is fiction, so the
    # substitution should land on a building the data knows only as a
    # footprint and a height -- not on somebody's named, occupied tower.
    MARKET = (-2200.0, -2200.0)
    for r in cand:
        d = math.hypot(r["x"] - MARKET[0], r["y"] - MARKET[1])
        r["dist_market"] = d
        r["score"] = (min(r["area"], 9000.0) / 9000.0) * 1.0 \
            + (min(r["h"], MAX_H) / MAX_H) * 0.8 \
            + max(0.0, 1.0 - d / 3000.0) * 1.2 \
            + (1.6 if not (r["name"].strip() or r["addr"].strip()) else 0.0)
    cand.sort(key=lambda r: -r["score"])
    for r in cand[:6]:
        print("    %-42s %6.1f m  %7.0f m2  %5.0f m away  %.3f"
              % ((r["name"] or r["addr"] or "bid %d" % r["bid"])[:42],
                 r["h"], r["area"], r["dist_market"], r["score"]))
    site = cand[0]

    st = nearest_street(edges, site["x"], site["y"])
    if not st:
        raise SystemExit("site has no drivable frontage within 220 m")
    sx, sy, swidth, sname = st

    # Local frame: +x from the street into the site, +y to its left.
    dx, dy = site["x"] - sx, site["y"] - sy
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    vx, vy = -uy, ux
    yaw = math.atan2(uy, ux)     # world y-rotation; the runtime uses this verbatim

    # Origin sits at the street frontage, so the lot is centred on the
    # building it replaces.
    ox = site["x"] - ux * (lot_d * 0.5)
    oy = site["y"] - uy * (lot_d * 0.5)

    def to_local(px, py):
        ex, ey = px - ox, py - oy
        return ex * ux + ey * uy, ex * vx + ey * vy

    def to_world(lx, ly):
        return ox + ux * lx + vx * ly, oy + uy * lx + vy * ly

    # ---- what the footprint covers ---------------------------------------
    covered = []
    for r in rows:
        if r["context"]:
            continue
        a, b = to_local(r["x"], r["y"])
        if -1.0 <= a <= lot_d + 1.0 and abs(b) <= lot_w * 0.5 + 1.0:
            covered.append(r)
    covered.sort(key=lambda r: -r["h"])

    # ---- does the podium stand in the road? -------------------------------
    podium = [to_world(plaza, -lot_w * 0.5), to_world(lot_d, -lot_w * 0.5),
              to_world(lot_d, lot_w * 0.5), to_world(plaza, lot_w * 0.5)]
    worst = None
    for e in edges:
        if not e.get("drivable"):
            continue
        p = e["pts"]
        for i in range(len(p) - 1):
            if math.hypot(p[i][0] - site["x"], p[i][1] - site["y"]) > 260:
                continue
            d = rect_seg_clearance(podium, p[i][0], p[i][1],
                                   p[i + 1][0], p[i + 1][1])
            half = e.get("width", 12.0) * 0.5
            slack = d - half
            if worst is None or slack < worst[0]:
                worst = (slack, d, half, e.get("name", ""))
    slack, dist, half, wname = worst

    out = {
        "site": {
            "bid": site["bid"], "name": site["name"], "addr": site["addr"],
            "district": site["district"], "replaced_height_m": site["h"],
            "lot_area_m2": site["area"],
            "centroid": [round(site["x"], 2), round(site["y"], 2)],
        },
        # what the runtime places the tower with
        "origin": [round(ox, 3), round(oy, 3)],
        "yaw": round(yaw, 6),
        "frontage": {"street": sname, "width_m": swidth,
                     "midpoint": [round(sx, 2), round(sy, 2)]},
        "footprint": {"width_m": lot_w, "depth_m": lot_d,
                      "plaza_depth_m": plaza,
                      "corners": [[round(a, 2), round(b, 2)]
                                  for a, b in podium]},
        # every registry building the footprint sits on. The runtime hides
        # exactly these and nothing else.
        "suppress": [r["bid"] for r in covered],
        "suppressed_detail": [
            {"bid": r["bid"], "name": r["name"] or r["addr"],
             "height_m": r["h"], "area_m2": r["area"]} for r in covered],
        "clearance": {
            "podium_to_centreline_m": round(dist, 2),
            "street_half_width_m": round(half, 2),
            "podium_to_kerb_m": round(slack, 2),
            "street": wname,
            "in_the_road": bool(slack < 0),
        },
        "candidates_considered": len(cand),
        "rule": "registry-picked: midtown, drivable frontage, lot >= %d m2, "
                "%d-%d m tall, not a landmark" % (MIN_AREA, MIN_H, MAX_H),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "hq_site.json"), "w") as fh:
        json.dump(out, fh, indent=2)

    # The runtime needs the tower's own dimensions and the room anchors as
    # well as the site. Copy the two sections it uses out of the Blender
    # report rather than typing them a second time -- they are generated, and
    # a second copy is a second thing to get wrong.
    with open(os.path.join(OUT_DIR, "hq_spec.json"), "w") as fh:
        json.dump({"tower": spec["tower"], "anchor": spec["anchor"],
                   "clearance": spec["clearance"],
                   "mission_control": spec["mission_control"],
                   "source": "docs/phase2/HQ_REPORT.json"}, fh, indent=2)

    print("-" * 74)
    print("  site      %s (bid %d)" % (site["name"] or site["addr"],
                                       site["bid"]))
    print("            %s, %s -- %.0f m2 lot, replacing %.0f m"
          % (site["addr"], site["district"], site["area"], site["h"]))
    print("  frontage  %s, %.1f m wide; yaw %.1f deg"
          % (sname, swidth, math.degrees(yaw)))
    print("  covers    %d registry buildings, tallest %.0f m"
          % (len(covered), covered[0]["h"] if covered else 0.0))
    for r in covered[:8]:
        print("              %-40s %6.1f m" %
              ((r["name"] or r["addr"] or "bid %d" % r["bid"])[:40], r["h"]))
    print("  clearance podium is %.1f m from the %s centreline, %.1f m from "
          "its kerb" % (dist, wname or "nearest street", slack))
    if slack < 0:
        print("  ** the podium overlaps the carriageway **")
    print("  -> %s" % os.path.relpath(os.path.join(OUT_DIR, "hq_site.json"),
                                      ROOT))


main()
