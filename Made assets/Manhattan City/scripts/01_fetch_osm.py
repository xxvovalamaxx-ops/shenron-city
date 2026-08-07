"""
01_fetch_osm.py — Acquire OpenStreetMap source data for the Manhattan world build.

Downloads, in separate passes (to stay inside Overpass timeouts / rate limits):
  - Manhattan borough admin boundary   -> used to clip buildings to the island
  - Coastline + water polygons (wide)  -> Hudson / East River / harbour landmass
  - Building footprints (Manhattan)    -> ~45k real polygons, split into lat bands
  - Road network (Manhattan + approaches)
  - Parks / green space
  - Bridges
  - Piers / wharfs / docks
  - Context landuse for Brooklyn / Queens / Jersey

Everything lands in ../source_data as raw Overpass JSON. Re-running skips files
that already exist (delete a file to force a refetch).

Usage:  python 01_fetch_osm.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "source_data"))
os.makedirs(OUT, exist_ok=True)

# Overpass mirrors, tried in order on failure.
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]

# Manhattan island bbox (south, west, north, east)
MAN = (40.6790, -74.0290, 40.8850, -73.9060)
# Wider bbox for water / context landmasses
WIDE = (40.5800, -74.1200, 40.9400, -73.7600)

# OSM relation for New York County (Manhattan borough). Overpass area id = 3600000000 + rel id
MANHATTAN_REL = 8398124
MANHATTAN_AREA = 3600000000 + MANHATTAN_REL


def bbox(b):
    return "%f,%f,%f,%f" % b


def fetch(name, query, timeout_s=900):
    """Run an Overpass query and cache the result as source_data/<name>.json."""
    path = os.path.join(OUT, name + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 200:
        print("  [skip] %s already present (%.1f MB)"
              % (name, os.path.getsize(path) / 1e6))
        return path

    body = query.strip()
    data = urllib.parse.urlencode({"data": body}).encode() if False else ("data=" + urllib.parse.quote(body)).encode()

    last_err = None
    for attempt, ep in enumerate([e for e in ENDPOINTS for _ in range(2)]):
        try:
            print("  [get ] %s  via %s (attempt %d)" % (name, ep.split("/")[2], attempt + 1))
            t0 = time.time()
            req = urllib.request.Request(
                ep, data=data,
                headers={"User-Agent": "manhattan-world-build/1.0 (blender procedural city)",
                         "Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(req, timeout=timeout_s) as r:
                raw = r.read()
            # Validate it parses and actually has elements before caching.
            probe = json.loads(raw.decode("utf-8", "replace"))
            n = len(probe.get("elements", []))
            if n == 0:
                raise ValueError("query returned 0 elements")
            with open(path, "wb") as f:
                f.write(raw)
            print("  [ ok ] %s  %d elements, %.1f MB, %.0fs"
                  % (name, n, len(raw) / 1e6, time.time() - t0))
            return path
        except Exception as e:  # noqa: BLE001 - want to try every mirror
            last_err = e
            print("  [fail] %s: %s" % (name, str(e)[:160]))
            time.sleep(8)

    print("  [ERR ] %s permanently failed: %s" % (name, last_err))
    return None


import urllib.parse  # noqa: E402  (used inside fetch)


# --------------------------------------------------------------------------
# Query definitions
# --------------------------------------------------------------------------

JOBS = []

# 1. Manhattan borough boundary (island clip polygon + coast reference)
JOBS.append(("boundary_manhattan", """
[out:json][timeout:300];
rel(%d);
out geom;
""" % MANHATTAN_REL))

# 2. Coastline in the wide area -> land/water separation for the whole harbour
JOBS.append(("coastline_wide", """
[out:json][timeout:600];
(
  way["natural"="coastline"](%s);
);
out geom;
""" % bbox(WIDE)))

# 3. Water bodies (rivers, reservoirs, ponds incl. Central Park water)
JOBS.append(("water_wide", """
[out:json][timeout:600];
(
  way["natural"="water"](%s);
  way["waterway"="riverbank"](%s);
  rel["natural"="water"](%s);
);
out geom;
""" % (bbox(WIDE), bbox(WIDE), bbox(WIDE))))

# 4-8. Buildings, split into 5 latitude bands to keep each response manageable.
#      Clipped to the Manhattan borough area so we don't pull Brooklyn/Queens/NJ.
_s, _w, _n, _e = MAN
BANDS = 5
for i in range(BANDS):
    lo = _s + (_n - _s) * i / BANDS
    hi = _s + (_n - _s) * (i + 1) / BANDS
    JOBS.append(("buildings_band%d" % i, """
[out:json][timeout:900];
area(%d)->.man;
(
  way["building"](area.man)(%f,%f,%f,%f);
);
out geom;
""" % (MANHATTAN_AREA, lo, _w, hi, _e)))

# 9. Road network across Manhattan (+ bridge approaches, so slightly wider)
JOBS.append(("roads_manhattan", """
[out:json][timeout:900];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](%s);
);
out geom;
""" % bbox(MAN)))

# 10. Parks and green space
JOBS.append(("parks_manhattan", """
[out:json][timeout:600];
(
  way["leisure"~"^(park|garden|pitch|golf_course|nature_reserve)$"](%s);
  way["landuse"~"^(grass|forest|meadow|recreation_ground|cemetery|village_green)$"](%s);
  rel["leisure"="park"](%s);
);
out geom;
""" % (bbox(MAN), bbox(MAN), bbox(MAN))))

# 11. Bridges (East River crossings, Hudson crossings, viaducts)
JOBS.append(("bridges_wide", """
[out:json][timeout:600];
(
  way["bridge"]["highway"](%s);
  way["bridge"]["railway"](%s);
  way["man_made"="bridge"](%s);
);
out geom;
""" % (bbox(WIDE), bbox(WIDE), bbox(WIDE))))

# 12. Piers, wharfs, docks, breakwaters
JOBS.append(("piers_wide", """
[out:json][timeout:600];
(
  way["man_made"~"^(pier|wharf|breakwater|groyne)$"](%s);
  way["waterway"="dock"](%s);
  way["amenity"="ferry_terminal"](%s);
);
out geom;
""" % (bbox(WIDE), bbox(WIDE), bbox(WIDE))))

# 13. Context buildings for the immediate Brooklyn / Queens / Jersey waterfront.
#     Only large footprints, so wide shots have silhouette without 200k polygons.
JOBS.append(("context_buildings", """
[out:json][timeout:900];
(
  way["building"]["height"](40.6800,-74.0700,40.7900,-74.0000);
  way["building"]["building:levels"](40.6800,-74.0700,40.7900,-74.0000);
  way["building"]["height"](40.6800,-74.0100,40.7600,-73.9200);
  way["building"]["building:levels"](40.6800,-74.0100,40.7600,-73.9200);
  way["building"]["height"](40.7300,-73.9700,40.7900,-73.9000);
  way["building"]["building:levels"](40.7300,-73.9700,40.7900,-73.9000);
);
out geom;
""" ))

# 14. Railways (for viaducts / yards / Hudson Yards context)
JOBS.append(("rail_manhattan", """
[out:json][timeout:600];
(
  way["railway"~"^(rail|light_rail|subway)$"]["tunnel"!~"."](%s);
);
out geom;
""" % bbox(MAN)))


def main():
    print("Manhattan OSM acquisition -> %s" % OUT)
    print("=" * 70)
    ok, failed = [], []
    for name, q in JOBS:
        r = fetch(name, q)
        (ok if r else failed).append(name)
        time.sleep(3)  # be polite to the public API

    print("=" * 70)
    print("done: %d ok, %d failed" % (len(ok), len(failed)))
    if failed:
        print("failed:", ", ".join(failed))

    total = 0
    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        if os.path.isfile(p):
            total += os.path.getsize(p)
            print("  %-28s %8.2f MB" % (f, os.path.getsize(p) / 1e6))
    print("total source data: %.2f MB" % (total / 1e6))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
