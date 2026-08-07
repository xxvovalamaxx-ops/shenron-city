"""
02_process_osm.py — turn raw Overpass JSON into compact build caches.

Runs on system Python (outside Blender) so the heavy parse doesn't stall the UI.
Writes pickles into source_data/cache/ which the Blender passes then load in
a couple of seconds.

Responsibilities
----------------
  * project every lat/lon to local metres (identical maths to blender_common)
  * stitch OSM coastline ways into closed rings -> Manhattan island + context land
  * derive a height for every building (real tag where present, zone model where not)
  * classify every building into a material/asset archetype
  * flatten roads, parks, water, bridges and piers into simple polyline/polygon lists

Usage:  python 02_process_osm.py
"""

import json
import math
import os
import pickle
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(HERE, "..", "source_data"))
CACHE = os.path.join(SRC, "cache")
DOCS = os.path.abspath(os.path.join(HERE, "..", "docs"))
os.makedirs(CACHE, exist_ok=True)
os.makedirs(DOCS, exist_ok=True)

# --- projection (must match blender_common.py exactly) --------------------
LAT0, LON0 = 40.7800, -73.9680
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))


def ll2xy(lat, lon):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def load(name):
    p = os.path.join(SRC, name + ".json")
    if not os.path.exists(p):
        print("  ! missing %s" % name)
        return {"elements": []}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def geom_xy(el):
    g = el.get("geometry") or []
    return [ll2xy(p["lat"], p["lon"]) for p in g if p]


# --------------------------------------------------------------------------
# geometry helpers
# --------------------------------------------------------------------------
def area2(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def centroid(pts):
    a = area2(pts)
    if abs(a) < 1e-9:
        n = float(len(pts)) or 1.0
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        c = x1 * y2 - x2 * y1
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    return (cx / (6 * a), cy / (6 * a))


def dedupe(pts, eps=0.05):
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    while len(out) >= 2 and math.hypot(out[0][0] - out[-1][0],
                                       out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def simplify(pts, tol=0.5):
    """Iterative Douglas-Peucker (no recursion limit risk on long shorelines)."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        x1, y1 = pts[i0]
        x2, y2 = pts[i1]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        worst, wi = -1.0, -1
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            if L2 < 1e-12:
                d = math.hypot(px - x1, py - y1)
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
                d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > worst:
                worst, wi = d, i
        if worst > tol and wi > 0:
            keep[wi] = True
            stack.append((i0, wi))
            stack.append((wi, i1))
    return [p for p, k in zip(pts, keep) if k]


def _segments_cross(a1, a2, b1, b2):
    def orient(p, q, r):
        v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else 2)
    return (orient(a1, a2, b1) != orient(a1, a2, b2) and
            orient(b1, b2, a1) != orient(b1, b2, a2))


def self_intersects(poly):
    """Does a closed ring cross itself?"""
    n = len(poly)
    if n < 4:
        return False
    for i in range(n):
        a1, a2 = poly[i], poly[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if _segments_cross(a1, a2, poly[j], poly[(j + 1) % n]):
                return True
    return False


def convex_hull(pts):
    """Andrew's monotone chain. Always simple, used as the last-resort ring."""
    p = sorted(set((round(x, 4), round(y, 4)) for (x, y) in pts))
    if len(p) < 3:
        return list(pts)

    def half(seq):
        out = []
        for q in seq:
            while len(out) >= 2:
                (ax, ay), (bx, by) = out[-2], out[-1]
                if (bx - ax) * (q[1] - ay) - (by - ay) * (q[0] - ax) <= 0:
                    out.pop()
                else:
                    break
            out.append(q)
        return out

    return half(p)[:-1] + half(reversed(p))[:-1]


def point_in(x, y, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and \
           (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi):
            inside = not inside
        j = i
    return inside


def stitch(ways, snap=1.5):
    """
    Join OSM coastline ways into continuous chains, PRESERVING WAY DIRECTION.

    This matters: OSM guarantees that land lies to the LEFT of a coastline way.
    Reversing a segment to make it chain (the obvious implementation) silently
    flips that, which puts the landmass on the water side and floods the rivers.
    So we only ever join tail -> head.

    Returns (closed_rings, open_chains), both in original way direction.
    """
    def key(p):
        return (round(p[0] / snap), round(p[1] / snap))

    segs = [list(w) for w in ways if len(w) >= 2]
    by_start = defaultdict(list)
    for i, s in enumerate(segs):
        by_start[key(s[0])].append(i)

    has_pred = [False] * len(segs)
    for s in segs:
        for j in by_start.get(key(s[-1]), []):
            has_pred[j] = True

    used = [False] * len(segs)
    rings, chains = [], []

    def walk(i):
        used[i] = True
        chain = list(segs[i])
        while True:
            nxt = None
            for j in by_start.get(key(chain[-1]), []):
                if not used[j]:
                    nxt = j
                    break
            if nxt is None:
                break
            used[nxt] = True
            chain.extend(segs[nxt][1:])
            if key(chain[-1]) == key(chain[0]):
                break
        return chain

    # heads first so open shorelines come out as one long chain each
    order = [i for i in range(len(segs)) if not has_pred[i]] + \
            [i for i in range(len(segs)) if has_pred[i]]
    for i in order:
        if used[i]:
            continue
        chain = walk(i)
        closed = (len(chain) > 3 and
                  math.hypot(chain[0][0] - chain[-1][0],
                             chain[0][1] - chain[-1][1]) <= snap * 4)
        (rings if closed else chains).append(dedupe(chain))
    return rings, chains


# --------------------------------------------------------------------------
# building height + classification
# --------------------------------------------------------------------------
FEET = 0.3048


def parse_height(s):
    if not s:
        return None
    s = str(s).strip().lower().replace("~", "").replace(",", ".")
    try:
        if s.endswith("m"):
            return float(s[:-1].strip())
        if "'" in s or s.endswith("ft") or s.endswith("feet"):
            return float(s.replace("ft", "").replace("feet", "")
                          .replace("'", "").strip()) * FEET
        v = float(s)
        # A bare number in OSM is metres. Guard against absurd values.
        return v if 0.5 < v < 600 else None
    except Exception:
        return None


def zone_height(x, y, foot_area, h):
    """
    Fallback height for the ~10% of footprints with no height/levels tag.
    Latitude bands follow real Manhattan neighbourhood character; footprint
    area and a deterministic hash add the spread.
    """
    lat = y / M_LAT + LAT0
    if lat < 40.7100:        base, spread = 34.0, 55.0   # Financial District
    elif lat < 40.7220:      base, spread = 20.0, 22.0   # Tribeca / Chinatown
    elif lat < 40.7320:      base, spread = 18.0, 16.0   # SoHo / LES / Village
    elif lat < 40.7450:      base, spread = 22.0, 26.0   # Chelsea / Gramercy
    elif lat < 40.7560:      base, spread = 34.0, 52.0   # Midtown South / Garment
    elif lat < 40.7680:      base, spread = 42.0, 78.0   # Midtown core
    elif lat < 40.7850:      base, spread = 30.0, 34.0   # UES / UWS lower
    elif lat < 40.8000:      base, spread = 26.0, 26.0   # UES / UWS upper
    elif lat < 40.8350:      base, spread = 20.0, 18.0   # Harlem / Morningside
    else:                    base, spread = 16.0, 14.0   # Washington Hts / Inwood

    # Bigger footprints skew taller (they're the office/apartment blocks).
    af = min(1.6, (foot_area / 700.0) ** 0.35)
    return max(6.0, base * af + spread * (h ** 2.4))


# archetype ids -> also used as material slot groups in Blender
CLS_SMALL, CLS_LOW, CLS_MID, CLS_HIGH, CLS_TOWER, CLS_GLASS, \
    CLS_INDUST, CLS_CIVIC = range(8)

CLS_NAMES = ["small", "lowrise", "midrise", "highrise",
             "tower", "glass", "industrial", "civic"]

_GLASSY = {"office", "commercial", "hotel", "retail"}
_CIVIC = {"church", "cathedral", "chapel", "school", "university", "hospital",
          "museum", "public", "civic", "government", "train_station",
          "synagogue", "temple", "mosque"}
_INDUST = {"industrial", "warehouse", "factory", "shed", "service",
           "garage", "garages", "hangar", "storage_tank"}


def classify(tags, height, foot_area, h):
    bt = (tags.get("building") or "yes").lower()
    if bt in _CIVIC:
        return CLS_CIVIC
    if bt in _INDUST:
        return CLS_INDUST
    if height >= 110.0:
        # Post-war towers read as glass; older masonry supertalls stay masonry.
        return CLS_GLASS if (bt in _GLASSY or h > 0.42) else CLS_TOWER
    if height >= 60.0:
        return CLS_GLASS if (bt in _GLASSY and h > 0.55) else CLS_HIGH
    if height >= 26.0:
        return CLS_MID
    if height >= 10.0:
        return CLS_LOW
    return CLS_SMALL


# --------------------------------------------------------------------------
# Landmark height corrections.
#
# OSM's Manhattan height import is excellent (97% coverage) but a handful of
# famous towers carry the height of a low annex or podium that happens to hold
# the name - the Chrysler Building comes through at 56 m, 30 Rockefeller Plaza
# at 10 m, the Seagram Building at 20 m. Their *footprints* are correct and
# full sized, so a name-keyed roof height is all that is needed to restore the
# skyline. Values are published architectural roof heights in metres.
# Only ever raises a height, never lowers one.
# --------------------------------------------------------------------------
LANDMARK_HEIGHTS = {
    "Chrysler Building": 318.9,
    "30 Rockefeller Plaza": 266.0,
    "Citigroup Center": 279.0,
    "Trump World Tower": 262.0,
    "Woolworth Building": 241.4,
    "Solow Building": 210.0,
    "Trump Tower": 202.0,
    "Trump International Hotel and Tower": 192.0,
    "Hearst Tower": 182.0,
    "One Rockefeller Plaza": 179.0,
    "Seagram Building": 156.9,
    "75 Rockefeller Plaza": 149.0,
    "Metropolitan Life Insurance Company Tower": 213.0,
    "New York Life Building": 187.0,
    "Municipal Building": 179.0,
    "American Radiator Building": 102.0,
    "Lipstick Building": 138.0,
}


# --------------------------------------------------------------------------
# District classification.
#
# Manhattan neighbourhoods approximated by latitude band, split east/west on
# Fifth Avenue's local-x where the split is meaningful. Good enough to filter,
# query and stream by district; not a legal boundary.
# --------------------------------------------------------------------------
def district_of(cx, cy, is_context):
    lat = cy / M_LAT + LAT0
    lon = cx / M_LON + LON0

    if is_context or lat < 40.6995 or lon < -74.0215 or lon > -73.9065:
        # rough borough split for everything off the island
        if lon < -74.0215 and lat < 40.7900:
            return "Jersey"
        if lat > 40.7960 and lon > -73.9330:
            return "Bronx"
        if lat < 40.7000 and lon > -74.0450:
            return "Brooklyn"
        if lon > -73.9600 and lat > 40.7280:
            return "Queens"
        if lon < -74.0500:
            return "Staten Island"
        return "Context"

    west = cx < -900.0           # roughly west of Fifth Avenue
    if lat < 40.7160:   return "Financial District"
    if lat < 40.7215:   return "Tribeca / Civic Center" if west else "Chinatown / Two Bridges"
    if lat < 40.7290:   return "SoHo / Hudson Square" if west else "Lower East Side"
    if lat < 40.7370:   return "West Village" if west else "East Village"
    if lat < 40.7460:   return "Chelsea" if west else "Gramercy / Flatiron"
    if lat < 40.7520:
        # Hudson Yards is a small west-side carve-out, not the whole band
        if west and cx < -2300.0:
            return "Hudson Yards"
        return "Garment / Midtown South" if west else "Murray Hill / Kips Bay"
    if lat < 40.7640:   return "Midtown West / Times Sq" if west else "Midtown East"
    if lat < 40.7720:   return "Hell's Kitchen" if west else "Turtle Bay / Sutton"
    if lat < 40.7850:   return "Upper West Side" if west else "Upper East Side"
    if lat < 40.8000:   return "UWS North / Columbia" if west else "Yorkville / Carnegie Hill"
    if lat < 40.8160:   return "Morningside Heights" if west else "East Harlem"
    if lat < 40.8350:   return "Harlem"
    if lat < 40.8550:   return "Washington Heights"
    return "Inwood"


def lod_tier(height, name, cls):
    """Coarse streaming/quality tier so downstream tools can prioritise."""
    if name and height >= 180.0:
        return "landmark"
    if height >= 120.0:
        return "skyline"
    if height >= 45.0:
        return "district"
    return "block"


def fnv(*args):
    """Deterministic hash in 0..1 so every rebuild is byte-identical."""
    hh = 2166136261
    for a in args:
        v = int(abs(a) * 1000) & 0xFFFFFFFF
        for _ in range(4):
            hh ^= v & 0xFF
            hh = (hh * 16777619) & 0xFFFFFFFF
            v >>= 8
    return (hh & 0xFFFFFF) / float(0xFFFFFF)


# --------------------------------------------------------------------------
# passes
# --------------------------------------------------------------------------
def process_buildings():
    print("[buildings]")
    out = []
    stats = Counter()
    heights_real = 0

    files = sorted(f for f in os.listdir(SRC)
                   if f.startswith("buildings_band") and f.endswith(".json"))
    files += [f for f in os.listdir(SRC) if f == "context_buildings.json"]

    seen_ids = set()
    for fn in files:
        is_context = fn.startswith("context")
        d = load(fn[:-5])
        for el in d["elements"]:
            if el.get("type") != "way":
                continue
            if el["id"] in seen_ids:
                continue
            tags = el.get("tags") or {}
            bt = tags.get("building")
            if bt is None or bt == "no":
                # pure building:part with no building tag -> skip, it would
                # double up with its parent envelope
                stats["skip_no_building_tag"] += 1
                continue

            # ---- underground structures ----------------------------------
            # OSM maps subway station concourses as building=train_station with
            # location=underground and a negative layer. They are sprawling -
            # Pennsylvania Station's outline spans 946 m - so extruding one
            # produces an enormous flat plate hovering over Midtown. They have
            # no above-ground presence and must not be built at all.
            if tags.get("location") == "underground":
                stats["skip_underground"] += 1
                continue
            if tags.get("tunnel") in ("yes", "building_passage"):
                stats["skip_tunnel"] += 1
                continue
            try:
                layer = int(str(tags.get("layer", "0")).split(";")[0])
            except Exception:
                layer = 0
            if layer < 0 and bt in ("train_station", "transportation",
                                    "parking", "yes"):
                stats["skip_negative_layer"] += 1
                continue

            # An explicit height of 0 means "no above-ground height", which is
            # information, not a missing value. Falling through to the zone
            # model is what gave Penn Station a 95 m roof.
            if tags.get("height") is not None and \
                    parse_height(tags.get("height")) is None and \
                    str(tags.get("height")).strip() in ("0", "0.0", "0 m"):
                stats["skip_explicit_zero_height"] += 1
                continue

            pts = dedupe(geom_xy(el))
            if len(pts) < 3:
                stats["skip_degenerate"] += 1
                continue
            a = abs(area2(pts))
            if a < 15.0:
                stats["skip_tiny"] += 1
                continue

            pts = simplify(pts, 0.45)
            if len(pts) < 3:
                stats["skip_degenerate"] += 1
                continue
            if len(pts) > 64:
                # Cap the vertex count by simplifying, not by uniform-stride
                # subsampling. Taking every Nth point ignores geometry and can
                # delete exactly the vertex that was keeping two edges apart,
                # producing a self-intersecting footprint whose roof cap then
                # tessellates into a shard. Douglas-Peucker only ever removes
                # points that lie close to the line they sit on.
                tol = 0.8
                while len(pts) > 64 and tol < 25.0:
                    pts = simplify(pts, tol)
                    tol *= 1.6
                if len(pts) > 64:
                    pts = pts[:64]

            # Absolute guarantee: a footprint that crosses itself produces a
            # bowtie roof cap, which tessellates into a shard. Neither the OSM
            # source nor Douglas-Peucker guarantees a simple ring, so fall back
            # to the convex hull, which always is. Affects a handful of
            # pathological outlines out of 56k.
            if self_intersects(pts):
                hull = convex_hull(pts)
                if len(hull) >= 3:
                    pts = hull
                    stats["footprint_hull_fallback"] += 1

            cx, cy = centroid(pts)
            h = fnv(cx, cy, el["id"])

            # height provenance is recorded so every building can be traced
            # back to the record it came from
            hsrc = "tag"
            height = parse_height(tags.get("height"))
            if height is None:
                lv = tags.get("building:levels")
                try:
                    if lv is not None:
                        height = float(str(lv).split(";")[0]) * 3.2 + 1.2
                        hsrc = "levels"
                except Exception:
                    height = None
            tagged = height is not None
            if not tagged:
                height = zone_height(cx, cy, a, h)
                hsrc = "zone_model"

            nm = tags.get("name")
            if nm and nm in LANDMARK_HEIGHTS and a > 800.0:
                fixed = LANDMARK_HEIGHTS[nm]
                if fixed > (height or 0) * 1.15:
                    height = fixed
                    hsrc = "landmark_override"
                    stats["landmark_height_fixed"] += 1

            height = max(3.0, min(546.0, height))
            min_h = parse_height(tags.get("min_height")) or 0.0

            if is_context:
                # Context boroughs only need to stop reading as empty grey
                # plate in wide shots. 24 m / 300 m2 left Brooklyn and Queens
                # almost bare; this keeps the ordinary 4-6 storey fabric that
                # actually fills the frame, while the query bboxes already cap
                # how far the context extends.
                if height < 12.0 or a < 130.0:
                    stats["skip_context_small"] += 1
                    continue

            # count only buildings that actually survive into the city
            if tagged:
                heights_real += 1
                stats["height_from_tag"] += 1
            else:
                stats["height_estimated"] += 1

            cls = classify(tags, height, a, h)
            stats["cls_" + CLS_NAMES[cls]] += 1

            hn = tags.get("addr:housenumber")
            st = tags.get("addr:street")
            addr = ("%s %s" % (hn, st)).strip() if (hn or st) else None

            out.append({
                "id": el["id"],                     # OSM way id - stable key
                "pts": pts,
                "h": height,
                "min_h": min_h,
                "hsrc": hsrc,                       # tag|levels|zone_model|landmark_override
                "cls": cls,
                "area": a,
                "cx": cx, "cy": cy,
                "rnd": h,
                "name": tags.get("name"),
                "addr": addr,
                "postcode": tags.get("addr:postcode"),
                "btype": tags.get("building"),      # raw OSM building=* value
                "levels": tags.get("building:levels"),
                "district": district_of(cx, cy, is_context),
                "lod": lod_tier(height, tags.get("name"), cls),
                "ctx": is_context,
            })
            seen_ids.add(el["id"])

    print("  %d buildings (%d with real height tags, %.1f%%)"
          % (len(out), heights_real, 100.0 * heights_real / max(1, len(out))))
    for k in sorted(stats):
        print("    %-24s %d" % (k, stats[k]))
    return out, stats


def process_land():
    print("[land / coastline]")
    d = load("coastline_wide")
    ways = [geom_xy(e) for e in d["elements"] if e.get("geometry")]
    ways = [dedupe(w) for w in ways]
    ways = [w for w in ways if len(w) >= 2]
    rings, chains = stitch(ways)
    print("  %d coastline ways -> %d closed rings, %d open chains"
          % (len(ways), len(rings), len(chains)))

    rings = [simplify(r, 2.0) for r in rings]
    rings = [r for r in rings if len(r) >= 3 and abs(area2(r)) > 5000.0]
    rings.sort(key=lambda r: -abs(area2(r)))

    # Manhattan is the ring containing the island centroid (0,0 in local space).
    island = None
    islands = []
    for r in rings:
        if point_in(0.0, 0.0, r) and island is None:
            island = r
        else:
            islands.append(r)

    if island is None and rings:
        island = rings[0]
        islands = rings[1:]

    print("  manhattan ring: %s pts, %.2f km2"
          % (len(island) if island else 0,
             abs(area2(island)) / 1e6 if island else 0))
    print("  other land rings: %d (largest %.2f km2)"
          % (len(islands), abs(area2(islands[0])) / 1e6 if islands else 0))

    chains = [simplify(c, 3.0) for c in chains if len(c) >= 3]
    return {"island": island, "islands": islands[:400], "chains": chains[:400]}


def process_land_raster(islands=None, cell=25.0,
                        x0=-13000.0, x1=17000.0,
                        y0=-22000.0, y1=17000.0):
    """
    Resolve land vs water for the whole harbour with a scanline winding number.

    Why not extrude a fixed-width strip inland from each shore: the East River
    is only ~600 m across, so any strip wide enough to read as a landmass in an
    aerial simply bridges the river and swallows Manhattan. Winding number has
    no width parameter and is exact.

    OSM guarantees land lies to the LEFT of a coastline way. Sweeping a row in
    +x, a segment running downward (dy<0) has its left side facing +x, so
    crossing it enters land (+1); an upward segment leaves land (-1). Cells
    where the accumulator is non-zero are land.

    Uses raw per-way direction, so it is immune to any stitching mistakes.
    Returns horizontal land spans, run-length encoded per row.
    """
    print("[land raster]")
    d = load("coastline_wide")

    segs = []           # (ya, yb, xa, xya_slope, dir)
    for el in d["elements"]:
        pts = geom_xy(el)
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            if ay == by:
                continue
            segs.append((ax, ay, bx, by))
    print("  %d directed coastline segments" % len(segs))

    nrows = int((y1 - y0) / cell)
    ncols = int((x1 - x0) / cell)

    # bucket segments by the rows they span so each row only tests its own
    buckets = [[] for _ in range(nrows)]
    for (ax, ay, bx, by) in segs:
        lo, hi = (ay, by) if ay < by else (by, ay)
        r0 = max(0, int((lo - y0) / cell))
        r1 = min(nrows - 1, int((hi - y0) / cell))
        if r1 < 0 or r0 >= nrows:
            continue
        for r in range(r0, r1 + 1):
            buckets[r].append((ax, ay, bx, by))

    spans = []
    for r in range(nrows):
        yc = y0 + (r + 0.5) * cell
        xs = []
        for (ax, ay, bx, by) in buckets[r]:
            if (ay > yc) == (by > yc):
                continue
            t = (yc - ay) / (by - ay)
            xs.append((ax + t * (bx - ax), -1 if by > ay else 1))
        if not xs:
            continue
        xs.sort()

        # Absolute state, not an accumulator. A running winding number assumes
        # the sweep starts in open water, but Long Island and New Jersey run
        # past the download bbox so their enclosing ways are simply absent and
        # the count never balances. Each crossing instead *sets* the state
        # outright from its own direction, which needs no far-field closure:
        #   downward segment (+1) -> now on land,  upward (-1) -> now in water.
        # The state before the first crossing is whatever that crossing implies
        # we were leaving.
        cur_land = (xs[0][1] == -1)
        cur_x = x0
        for (x, dirn) in xs:
            if cur_land and x > cur_x:
                a, b = max(x0, cur_x), min(x1, x)
                if b - a > cell * 0.5:
                    spans.append((yc, a, b))
            cur_land = (dirn == 1)
            cur_x = max(cur_x, x)
        if cur_land and cur_x < x1:
            spans.append((yc, max(x0, cur_x), x1))

    # ---- morphological close over rows ----------------------------------
    # Out in Long Island Sound the coastline is sparse enough that adjacent
    # scanlines disagree, which renders as hard horizontal land/water striping
    # across the far background. Rasterise to a grid, fill any cell that has
    # land both above and below, then re-extract. Two passes is plenty.
    grid = [bytearray(ncols) for _ in range(nrows)]
    for (yc, a, b) in spans:
        r = int((yc - y0) / cell)
        if not (0 <= r < nrows):
            continue
        ca = max(0, int((a - x0) / cell))
        cb = min(ncols, int(math.ceil((b - x0) / cell)))
        row = grid[r]
        for c in range(ca, cb):
            row[c] = 1

    for _ in range(4):
        for r in range(2, nrows - 2):
            cur = grid[r]
            u1, u2, d1, d2 = grid[r - 1], grid[r - 2], grid[r + 1], grid[r + 2]
            for c in range(ncols):
                if cur[c]:
                    continue
                # bridge gaps of one or two rows in either direction
                if (u1[c] and d1[c]) or (u1[c] and d2[c]) or (u2[c] and d1[c]):
                    cur[c] = 1
    # and close single-column pinholes left along the shoreline
    for r in range(nrows):
        cur = grid[r]
        for c in range(1, ncols - 1):
            if not cur[c] and cur[c - 1] and cur[c + 1]:
                cur[c] = 1

    spans = []
    for r in range(nrows):
        yc = y0 + (r + 0.5) * cell
        row = grid[r]
        c = 0
        while c < ncols:
            if row[c]:
                c0 = c
                while c < ncols and row[c]:
                    c += 1
                spans.append((yc, x0 + c0 * cell, x0 + c * cell))
            else:
                c += 1

    area = sum((b - a) for (_, a, b) in spans) * cell / 1e6
    print("  %d land spans over %d rows, %.1f km2 of land in frame"
          % (len(spans), nrows, area))

    # ---- carve out the precisely modelled islands ------------------------
    # Manhattan's coastline is modelled from the real OSM ring at ~25 m
    # detail. The raster covers it too, and a 50 m staircase sitting 0.5 m
    # below pokes out past that ring all along the waterfront - which is the
    # jagged edge on the Manhattan side. Remove those cells (dilated by one,
    # so nothing peeks out) and let the precise polygon own its own shore.
    carved = 0
    if islands:
        for ring in islands:
            if not ring or len(ring) < 3:
                continue
            rxs = [p[0] for p in ring]
            rys = [p[1] for p in ring]
            ca0 = max(0, int((min(rxs) - x0) / cell) - 2)
            ca1 = min(ncols, int((max(rxs) - x0) / cell) + 3)
            ra0 = max(0, int((min(rys) - y0) / cell) - 2)
            ra1 = min(nrows, int((max(rys) - y0) / cell) + 3)
            hits = []
            for r in range(ra0, ra1):
                yc = y0 + (r + 0.5) * cell
                row = grid[r]
                for c in range(ca0, ca1):
                    if row[c] and point_in(x0 + (c + 0.5) * cell, yc, ring):
                        hits.append((r, c))
            for (r, c) in hits:
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        rr, cc = r + dr, c + dc
                        if 0 <= rr < nrows and 0 <= cc < ncols and grid[rr][cc]:
                            grid[rr][cc] = 0
                            carved += 1
    print("  carved %d cells out from under %d precise island polygons"
          % (carved, len(islands or [])))

    contours = trace_contours(grid, nrows, ncols, cell, x0, y0)
    print("  %d smoothed shoreline contours (%d points total)"
          % (len(contours), sum(len(c) for c in contours)))

    return {"spans": spans, "cell": cell, "contours": contours,
            "bounds": (x0, y0, x1, y1), "land_km2": area}


def trace_contours(grid, nrows, ncols, cell, x0, y0, chaikin=2, tol=3.0):
    """
    Walk the land/water boundary of the raster and return smooth polygons.

    A cell grid renders as a staircase no matter how the quads are welded -
    the steps are the data, not the mesh. Tracing the boundary into loops and
    smoothing those loops removes the staircase *and* produces far fewer
    faces than one quad per cell.

    Edges are emitted with land on the left so loops come out counter-
    clockwise around land and clockwise around holes, which is what a
    triangulator wants.
    """
    def land(r, c):
        return 0 <= r < nrows and 0 <= c < ncols and grid[r][c]

    # boundary segments keyed by start lattice point
    seg = {}
    for r in range(nrows):
        row = grid[r]
        for c in range(ncols):
            if not row[c]:
                continue
            if not land(r - 1, c):
                seg.setdefault((c, r), []).append((c + 1, r))
            if not land(r, c + 1):
                seg.setdefault((c + 1, r), []).append((c + 1, r + 1))
            if not land(r + 1, c):
                seg.setdefault((c + 1, r + 1), []).append((c, r + 1))
            if not land(r, c - 1):
                seg.setdefault((c, r + 1), []).append((c, r))

    loops = []
    for start in list(seg.keys()):
        while seg.get(start):
            loop = [start]
            cur = start
            while True:
                nxts = seg.get(cur)
                if not nxts:
                    break
                nxt = nxts.pop()
                if not nxts:
                    del seg[cur]
                loop.append(nxt)
                cur = nxt
                if cur == start:
                    break
            if len(loop) > 8:
                loops.append(loop[:-1] if loop[-1] == loop[0] else loop)

    out = []
    for loop in loops:
        pts = [(x0 + c * cell, y0 + r * cell) for (c, r) in loop]
        if len(pts) < 8:
            continue
        # Chaikin corner-cutting rounds the rectilinear staircase...
        for _ in range(chaikin):
            nxt = []
            n = len(pts)
            for i in range(n):
                ax, ay = pts[i]
                bx, by = pts[(i + 1) % n]
                nxt.append((ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25))
                nxt.append((ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75))
            pts = nxt
        # ...but rounding corners does not reduce the step *amplitude*, so a
        # Chaikin-only shore is smooth and still wobbles by half a cell.
        # A few Laplacian passes damp that high-frequency wobble while
        # leaving the bay-and-headland shape intact.
        pts = smooth_ring(pts, passes=14, factor=0.5)
        pts = simplify(pts, tol)
        if len(pts) >= 3 and abs(area2(pts)) > cell * cell * 4.0:
            out.append(pts)
    out.sort(key=lambda p: -abs(area2(p)))
    return out


def smooth_ring(pts, passes=10, factor=0.5):
    """Laplacian smoothing on a closed ring."""
    n = len(pts)
    if n < 5:
        return pts
    cur = list(pts)
    for _ in range(passes):
        nxt = []
        for i in range(n):
            ax, ay = cur[i - 1]
            bx, by = cur[i]
            cx, cy = cur[(i + 1) % n]
            nxt.append((bx + ((ax + cx) * 0.5 - bx) * factor,
                        by + ((ay + cy) * 0.5 - by) * factor))
        cur = nxt
    return cur


def process_water():
    print("[water]")
    d = load("water_wide")
    polys = []
    for el in d["elements"]:
        pts = dedupe(geom_xy(el))
        if len(pts) < 3:
            continue
        a = abs(area2(pts))
        if a < 400.0:
            continue
        tags = el.get("tags") or {}
        polys.append({"pts": simplify(pts, 1.5), "area": a,
                      "name": tags.get("name")})
    polys.sort(key=lambda p: -p["area"])
    print("  %d water polygons (largest: %s, %.2f km2)"
          % (len(polys), polys[0]["name"] if polys else "-",
             polys[0]["area"] / 1e6 if polys else 0))
    return polys


def process_parks():
    print("[parks]")
    d = load("parks_manhattan")
    polys = []
    for el in d["elements"]:
        pts = dedupe(geom_xy(el))
        if len(pts) < 3:
            continue
        a = abs(area2(pts))
        if a < 250.0:
            continue
        tags = el.get("tags") or {}
        kind = tags.get("leisure") or tags.get("landuse") or "park"
        polys.append({"pts": simplify(pts, 1.5), "area": a,
                      "name": tags.get("name"), "kind": kind})
    polys.sort(key=lambda p: -p["area"])
    print("  %d park polygons (largest: %s, %.2f km2)"
          % (len(polys), polys[0]["name"] if polys else "-",
             polys[0]["area"] / 1e6 if polys else 0))
    return polys


ROAD_W = {
    "motorway": 22.0, "trunk": 20.0, "primary": 17.0, "secondary": 14.0,
    "tertiary": 12.0, "residential": 10.0, "unclassified": 9.0,
    "living_street": 8.0,
    "motorway_link": 8.0, "trunk_link": 8.0, "primary_link": 8.0,
    "secondary_link": 7.0, "tertiary_link": 7.0,
}


def process_roads():
    print("[roads]")
    d = load("roads_manhattan")
    out = []
    for el in d["elements"]:
        pts = dedupe(geom_xy(el), 0.8)
        if len(pts) < 2:
            continue
        tags = el.get("tags") or {}
        hw = tags.get("highway", "residential")
        w = ROAD_W.get(hw, 9.0)
        lanes = tags.get("lanes")
        try:
            if lanes:
                w = max(w, float(str(lanes).split(";")[0]) * 3.3)
        except Exception:
            pass
        out.append({
            "pts": simplify(pts, 1.0),
            "w": w,
            "hw": hw,
            "bridge": bool(tags.get("bridge")),
            "tunnel": bool(tags.get("tunnel")),
            "oneway": tags.get("oneway") in ("yes", "1", "-1"),
            "name": tags.get("name"),
        })
    print("  %d road segments" % len(out))
    return out


def process_bridges():
    print("[bridges]")
    d = load("bridges_wide")
    out = []
    for el in d["elements"]:
        pts = dedupe(geom_xy(el), 1.0)
        if len(pts) < 2:
            continue
        tags = el.get("tags") or {}
        length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        if length < 40.0:
            continue
        out.append({
            "pts": simplify(pts, 2.0),
            "name": tags.get("name"),
            "len": length,
            "layer": int(tags.get("layer") or 1),
            "rail": bool(tags.get("railway")),
            "hw": tags.get("highway"),
        })
    out.sort(key=lambda b: -b["len"])
    print("  %d bridge spans (longest: %s %.0f m)"
          % (len(out), out[0]["name"] if out else "-", out[0]["len"] if out else 0))
    return out


def process_piers():
    print("[piers]")
    d = load("piers_wide")
    out = []
    for el in d["elements"]:
        pts = dedupe(geom_xy(el), 0.8)
        if len(pts) < 2:
            continue
        tags = el.get("tags") or {}
        closed = (len(pts) >= 3 and
                  math.dist(pts[0], pts[-1]) < 3.0) or len(pts) >= 4
        out.append({
            "pts": simplify(pts, 1.0),
            "kind": tags.get("man_made") or tags.get("waterway") or "pier",
            "name": tags.get("name"),
            "closed": closed,
        })
    print("  %d pier/wharf features" % len(out))
    return out


def main():
    print("Manhattan OSM processing")
    print("=" * 70)
    report = {}

    land = process_land()
    precise = ([land["island"]] if land.get("island") else []) + \
        [r for r in land.get("islands", []) if r and len(r) >= 3]
    land["raster"] = process_land_raster(islands=precise)
    pickle.dump(land, open(os.path.join(CACHE, "land.pkl"), "wb"), 4)
    report["land_raster_km2"] = round(land["raster"]["land_km2"], 1)
    report["land_raster_spans"] = len(land["raster"]["spans"])
    report["island_pts"] = len(land["island"] or [])
    report["island_km2"] = abs(area2(land["island"])) / 1e6 if land["island"] else 0
    report["context_land_rings"] = len(land["islands"])

    water = process_water()
    pickle.dump(water, open(os.path.join(CACHE, "water.pkl"), "wb"), 4)
    report["water_polys"] = len(water)

    parks = process_parks()
    pickle.dump(parks, open(os.path.join(CACHE, "parks.pkl"), "wb"), 4)
    report["parks"] = len(parks)

    roads = process_roads()
    pickle.dump(roads, open(os.path.join(CACHE, "roads.pkl"), "wb"), 4)
    report["road_segments"] = len(roads)

    bridges = process_bridges()
    pickle.dump(bridges, open(os.path.join(CACHE, "bridges.pkl"), "wb"), 4)
    report["bridge_spans"] = len(bridges)

    piers = process_piers()
    pickle.dump(piers, open(os.path.join(CACHE, "piers.pkl"), "wb"), 4)
    report["piers"] = len(piers)

    blds, bstats = process_buildings()
    pickle.dump(blds, open(os.path.join(CACHE, "buildings.pkl"), "wb"), 4)
    report["buildings"] = len(blds)
    report["building_stats"] = dict(bstats)
    if blds:
        hs = sorted(b["h"] for b in blds)
        report["height_median"] = hs[len(hs) // 2]
        report["height_p95"] = hs[int(len(hs) * 0.95)]
        report["height_max"] = hs[-1]
        report["tallest"] = sorted(
            [(b["h"], b["name"]) for b in blds if b["name"]], reverse=True)[:15]
        report["total_footprint_verts"] = sum(len(b["pts"]) for b in blds)

    with open(os.path.join(DOCS, "data_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)

    print("=" * 70)
    print(json.dumps({k: v for k, v in report.items()
                      if k not in ("building_stats",)}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
