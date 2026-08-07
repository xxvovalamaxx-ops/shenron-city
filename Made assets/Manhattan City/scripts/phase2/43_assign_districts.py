"""
43_assign_districts.py -- Phase 2B: authoritative neighbourhood assignment.

Phase 1 approximated Manhattan districts with latitude bands split east/west at
a fixed local-x. On an island rotated ~29 degrees that split drifts across the
avenues, and the result was measurably wrong:

    Upper West Side     1071 buildings   (real stock is several thousand)
    East Village          70
    Chinatown             42
    East Harlem          5016             (absorbing its neighbours)

This script replaces the guess with the city's own polygons: the 2020
Neighborhood Tabulation Areas (NYC Open Data 9nt8-h7nd, 38 areas covering
Manhattan). Every Manhattan building is point-in-polygon tested against them.

Phase 1 scripts are frozen, so this runs as a Phase 2 enrichment on the
registry rather than a change to 02_process_osm.py. The Phase 1 label is kept
in `district_coarse` so the two can be compared.

Writes:  district, nta_id, nta_type, cdta_name, district_coarse
Usage:   python scripts/phase2/43_assign_districts.py
"""

import csv
import json
import os
import sys
import time
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REG = os.path.join(ROOT, "data", "manhattan", "buildings")
NYC = os.path.join(ROOT, "source_data", "nyc")
DOCS = os.path.join(ROOT, "docs", "phase2")

# NTA type codes used by DCP. 0 is a normal residential/mixed area; the rest
# are parks, water and special districts that still legitimately hold
# structures (Central Park has buildings, so does Randall's Island).
NTA_TYPE = {
    "0": "neighborhood", "5": "park", "6": "special", "9": "park_water",
}


def load_ntas():
    path = os.path.join(NYC, "nta.json")
    if not os.path.exists(path):
        print("missing %s -- run 40_fetch_nyc_open_data.py --only nta" % path)
        return None
    raw = json.load(open(path, encoding="utf-8"))
    ntas = []
    for r in raw:
        g = r.get("the_geom") or {}
        if g.get("type") == "Polygon":
            polys = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        # bbox over every ring so the point test can be skipped cheaply
        x0 = y0 = 1e18
        x1 = y1 = -1e18
        cooked = []
        for poly in polys:
            rings = []
            for ring in poly:
                pts = [(float(p[0]), float(p[1])) for p in ring]
                rings.append(pts)
                for px, py in pts:
                    x0 = min(x0, px); x1 = max(x1, px)
                    y0 = min(y0, py); y1 = max(y1, py)
            if rings:
                cooked.append(rings)
        if not cooked:
            continue
        ntas.append({
            "id": r.get("nta2020", ""),
            "name": r.get("ntaname", ""),
            "type": NTA_TYPE.get(str(r.get("ntatype", "0")), "other"),
            "cdta": r.get("cdtaname", ""),
            "polys": cooked,
            "bbox": (x0, y0, x1, y1),
        })
    return ntas


def in_ring(x, y, ring):
    """Even-odd crossing test. Boundary handling is arbitrary but stable."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            t = (y - yi) / (yj - yi)
            if x < xi + t * (xj - xi):
                inside = not inside
        j = i
    return inside


def in_nta(x, y, nta):
    x0, y0, x1, y1 = nta["bbox"]
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    for rings in nta["polys"]:
        if not in_ring(x, y, rings[0]):
            continue
        for hole in rings[1:]:
            if in_ring(x, y, hole):
                break
        else:
            return True
    return False


def main():
    t0 = time.time()
    ntas = load_ntas()
    if not ntas:
        return 2

    src = os.path.join(REG, "building_registry.csv")
    if not os.path.exists(src):
        print("no registry; run 41_build_registry.py first")
        return 2
    rows = list(csv.DictReader(open(src, encoding="utf-8")))

    hits = Counter()
    n_mn = n_hit = n_miss = 0
    # cheap locality cache: consecutive rows are usually on the same block
    last = None

    for r in rows:
        ctx = (r.get("is_context") or "").strip().lower() in ("1", "true",
                                                              "yes")
        if "district_coarse" not in r or not r.get("district_coarse"):
            r["district_coarse"] = r.get("district", "")
        if ctx:
            r["nta_id"] = ""
            r["nta_type"] = ""
            r["cdta_name"] = ""
            continue
        n_mn += 1
        try:
            lon = float(r.get("lon") or 0.0)
            lat = float(r.get("lat") or 0.0)
        except ValueError:
            lon = lat = 0.0

        found = None
        if last is not None and in_nta(lon, lat, last):
            found = last
        else:
            for nt in ntas:
                if in_nta(lon, lat, nt):
                    found = nt
                    last = nt
                    break

        if found:
            r["district"] = found["name"]
            r["nta_id"] = found["id"]
            r["nta_type"] = found["type"]
            r["cdta_name"] = found["cdta"]
            hits[found["name"]] += 1
            n_hit += 1
        else:
            # outside every Manhattan NTA: keep the Phase 1 label, flag it
            r["nta_id"] = ""
            r["nta_type"] = "unassigned"
            r["cdta_name"] = ""
            n_miss += 1

    cols = list(rows[0].keys())
    for c in ("district_coarse", "nta_id", "nta_type", "cdta_name"):
        if c not in cols:
            cols.append(c)
    with open(src, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    report = {
        "buildings": len(rows),
        "manhattan": n_mn,
        "assigned": n_hit,
        "unassigned": n_miss,
        "coverage_pct": round(100.0 * n_hit / n_mn, 2) if n_mn else 0.0,
        "ntas_defined": len(ntas),
        "ntas_used": len(hits),
        "distribution": dict(hits.most_common()),
        "source": "NYC Open Data 9nt8-h7nd, 2020 Neighborhood Tabulation Areas",
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "DISTRICT_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("=" * 74)
    print("PHASE 2B  DISTRICT ASSIGNMENT  (NYC 2020 NTAs)")
    print("=" * 74)
    print("  manhattan buildings  : %d" % n_mn)
    print("  assigned to an NTA   : %d  (%.2f%%)"
          % (n_hit, 100.0 * n_hit / n_mn if n_mn else 0))
    print("  unassigned           : %d" % n_miss)
    print("  NTAs used            : %d of %d" % (len(hits), len(ntas)))
    print("-" * 74)
    for k, v in hits.most_common():
        print("    %-46s %6d  %5.1f%%" % (k, v, 100.0 * v / n_hit))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
