"""
41_build_registry.py — Phase 2B: canonical building registry.

Runs on system Python.

Fuses three sources into one permanent per-building record:

  OSM        footprint geometry + height   (the accepted Phase 1 foundation)
  NYC BUILDING  BIN, BBL, surveyed height_roof, ground_elevation,
                construction_year, official footprint
  NYC PLUTO     land use, building class, year built, floors, units, areas,
                address, owner, zoning

Matching chain
--------------
OSM building  --(spatial)-->  NYC BUILDING  --(BBL)-->  PLUTO lot

OSM->BUILDING is a real spatial match between two building polygons, scored on
centroid distance and footprint-area similarity, so it is far more reliable
than matching a building to a tax-lot point. BUILDING->PLUTO is then an exact
key join on BBL.

Nothing is silently accepted: every row records which sources matched, the
match distance, the area ratio and a confidence band. Unmatched and ambiguous
cases are written to review lists rather than being quietly guessed.

Outputs:
  data/manhattan/buildings/building_registry.json      (full records)
  data/manhattan/buildings/building_registry.csv       (flat, greppable)
  data/manhattan/buildings/review_unmatched.csv
  data/manhattan/buildings/review_ambiguous.csv
  docs/phase2/REGISTRY_REPORT.json

Usage:  python scripts/phase2/41_build_registry.py
"""

import csv
import json
import math
import os
import pickle
import sys
import time
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NYC = os.path.join(ROOT, "source_data", "nyc")
CACHE = os.path.join(ROOT, "source_data", "cache")
OUTDIR = os.path.join(ROOT, "data", "manhattan", "buildings")
DOCS = os.path.join(ROOT, "docs", "phase2")

# projection must match blender_common exactly
LAT0, LON0 = 40.7800, -73.9680
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
FT = 0.3048

MATCH_RADIUS = 45.0      # m; beyond this two footprints are not the same one
GRID = 100.0             # spatial hash cell


def ll2xy(lat, lon):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def poly_area_centroid(ring):
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    a *= 0.5
    if abs(a) < 1e-9:
        n = float(n) or 1.0
        return 0.0, (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    return abs(a), (cx / (6.0 * a), cy / (6.0 * a))


def load_nyc_buildings():
    """NYC BUILDING footprints -> centroid, area, attributes."""
    p = os.path.join(NYC, "building.json")
    if not os.path.exists(p):
        return []
    raw = json.load(open(p, encoding="utf-8"))
    out = []
    for r in raw:
        g = r.get("the_geom")
        if not g:
            continue
        coords = g.get("coordinates") or []
        # MultiPolygon -> take the largest ring
        best_ring, best_a = None, -1.0
        stack = list(coords)
        while stack:
            item = stack.pop()
            if (isinstance(item, list) and item and
                    isinstance(item[0], list) and item[0] and
                    isinstance(item[0][0], (int, float))):
                ring = [ll2xy(c[1], c[0]) for c in item if len(c) >= 2]
                if len(ring) >= 3:
                    a, _ = poly_area_centroid(ring)
                    if a > best_a:
                        best_a, best_ring = a, ring
            elif isinstance(item, list):
                stack.extend(item)
        if best_ring is None:
            continue
        area, (cx, cy) = poly_area_centroid(best_ring)
        try:
            hr = float(r.get("height_roof") or 0) * FT
        except Exception:
            hr = 0.0
        try:
            ge = float(r.get("ground_elevation") or 0) * FT
        except Exception:
            ge = 0.0
        out.append({
            "bin": str(r.get("bin") or ""),
            "bbl": (str(r.get("base_bbl") or "").split(".")[0]),
            "bbl_mappluto": (str(r.get("mappluto_bbl") or "").split(".")[0]),
            "cx": cx, "cy": cy, "area": area,
            "height_roof_m": round(hr, 2),
            "ground_elev_m": round(ge, 2),
            "year": (str(r.get("construction_year") or "").split(".")[0]),
            "feature_code": str(r.get("feature_code") or ""),
            "geom_source": str(r.get("geom_source") or ""),
        })
    return out


def load_pluto():
    p = os.path.join(NYC, "pluto.json")
    if not os.path.exists(p):
        return {}
    raw = json.load(open(p, encoding="utf-8"))
    by_bbl = {}
    for r in raw:
        bbl = str(r.get("bbl") or "").split(".")[0]
        if bbl:
            by_bbl[bbl] = r
    return by_bbl


def fnum(v, default=None):
    try:
        return float(v)
    except Exception:
        return default


def main():
    t0 = time.time()
    os.makedirs(OUTDIR, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)

    print("=" * 78)
    print("PHASE 2B  CANONICAL BUILDING REGISTRY")
    print("=" * 78)

    osm = pickle.load(open(os.path.join(CACHE, "buildings.pkl"), "rb"))
    print("  OSM buildings        : %d" % len(osm))

    nycb = load_nyc_buildings()
    print("  NYC BUILDING footprints: %d" % len(nycb))

    pluto = load_pluto()
    print("  PLUTO lots           : %d" % len(pluto))

    # ---- spatial index over NYC footprints -------------------------------
    idx = defaultdict(list)
    for i, b in enumerate(nycb):
        idx[(int(b["cx"] // GRID), int(b["cy"] // GRID))].append(i)

    # ---- match ------------------------------------------------------------
    stats = Counter()
    rows = []
    unmatched = []
    ambiguous = []
    used_nyc = Counter()

    for bid, o in enumerate(osm):
        ox, oy, oarea = o["cx"], o["cy"], o["area"]
        gx, gy = int(ox // GRID), int(oy // GRID)
        cands = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cands.extend(idx.get((gx + dx, gy + dy), ()))

        best = None
        best_score = -1.0
        second = -1.0
        for i in cands:
            nb = nycb[i]
            d = math.hypot(nb["cx"] - ox, nb["cy"] - oy)
            if d > MATCH_RADIUS:
                continue
            ratio = (min(nb["area"], oarea) / max(nb["area"], oarea)
                     if max(nb["area"], oarea) > 0 else 0.0)
            # distance term falls off over the match radius; area term rewards
            # footprints of genuinely similar size
            score = (1.0 - d / MATCH_RADIUS) * 0.55 + ratio * 0.45
            if score > best_score:
                second = best_score
                best_score, best = score, (i, d, ratio)
            elif score > second:
                second = score

        rec = {
            "building_id": bid,
            "osm_id": o["id"],
            "osm_type": "way",
            "x_m": round(ox, 2), "y_m": round(oy, 2),
            "lat": round(oy / M_LAT + LAT0, 7),
            "lon": round(ox / M_LON + LON0, 7),
            "footprint_area": round(oarea, 1),
            "footprint_verts": len(o["pts"]),
            "roof_height": round(o["h"], 2),
            "height_source": o.get("hsrc", ""),
            "min_height": round(o.get("min_h", 0.0), 2),
            "building_name": o.get("name") or "",
            "address": o.get("addr") or "",
            "postcode": o.get("postcode") or "",
            "district": o.get("district") or "",
            "osm_building_type": o.get("btype") or "",
            "osm_levels": o.get("levels") or "",
            "lod_tier": o.get("lod", ""),
            "is_context": int(bool(o.get("ctx"))),
        }

        if best is None:
            stats["no_nyc_match"] += 1
            rec.update({"bin": "", "bbl": "", "match_confidence": "none",
                        "match_distance_m": "", "match_area_ratio": ""})
            unmatched.append(rec)
        else:
            i, d, ratio = best
            nb = nycb[i]
            used_nyc[i] += 1
            # confidence bands: distance AND area must both agree for "high"
            if d < 8.0 and ratio > 0.75:
                conf = "high"
            elif d < 20.0 and ratio > 0.45:
                conf = "medium"
            else:
                conf = "low"
            stats["match_" + conf] += 1
            if second > 0 and (best_score - second) < 0.06:
                stats["ambiguous"] += 1
                ambiguous.append({**rec, "bin": nb["bin"],
                                  "best": round(best_score, 3),
                                  "second": round(second, 3),
                                  "distance_m": round(d, 1)})
            rec.update({
                "bin": nb["bin"], "bbl": nb["bbl"],
                "bbl_mappluto": nb["bbl_mappluto"],
                "match_confidence": conf,
                "match_distance_m": round(d, 1),
                "match_area_ratio": round(ratio, 3),
                "nyc_height_roof": nb["height_roof_m"],
                "nyc_ground_elev": nb["ground_elev_m"],
                "nyc_year": nb["year"],
                "nyc_area": round(nb["area"], 1),
                "nyc_feature_code": nb["feature_code"],
            })

        # ---- PLUTO join on BBL -------------------------------------------
        # Condominiums are the trap here: PLUTO stores a condo lot under its
        # billing BBL, while the DOB footprint dataset carries the condo's own
        # BBL in mappluto_bbl (base_bbl is the pre-condo parcel, which PLUTO
        # no longer lists). So try the base BBL first, then fall back to the
        # mappluto BBL — otherwise the newest, tallest stock joins nothing
        # (P2-013).
        pl = None
        bbl_source = ""
        tried = set()
        for candidate, source in ((rec.get("bbl") or "", "base"),
                                  (rec.get("bbl_mappluto") or "", "mappluto")):
            if not candidate or candidate in tried:
                continue
            tried.add(candidate)
            pl = pluto.get(candidate)
            if pl:
                rec["bbl"] = candidate
                bbl_source = source
                break
        if pl:
            stats["pluto_joined"] += 1
            if bbl_source == "mappluto":
                stats["pluto_joined_via_mappluto"] += 1
            rec.update({
                "bbl_source": bbl_source,
                "land_use": pl.get("landuse") or "",
                "building_class": pl.get("bldgclass") or "",
                "year_built": (pl.get("yearbuilt") or "").split(".")[0],
                "year_altered": (pl.get("yearalter1") or "").split(".")[0],
                "number_of_floors": fnum(pl.get("numfloors"), "") or "",
                "units_res": (pl.get("unitsres") or "").split(".")[0],
                "units_total": (pl.get("unitstotal") or "").split(".")[0],
                "lot_area": fnum(pl.get("lotarea"), "") or "",
                "bldg_area": fnum(pl.get("bldgarea"), "") or "",
                "office_area": fnum(pl.get("officearea"), "") or "",
                "retail_area": fnum(pl.get("retailarea"), "") or "",
                "res_area": fnum(pl.get("resarea"), "") or "",
                "garage_area": fnum(pl.get("garagearea"), "") or "",
                "factory_area": fnum(pl.get("factryarea"), "") or "",
                "pluto_address": pl.get("address") or "",
                "owner": pl.get("ownername") or "",
                "zoning": pl.get("zonedist1") or "",
                "built_far": fnum(pl.get("builtfar"), "") or "",
                "community_district": pl.get("cd") or "",
                "num_bldgs_on_lot": (pl.get("numbldgs") or "").split(".")[0],
            })
        else:
            stats["pluto_missing"] += 1
            rec["bbl_source"] = ""

        rows.append(rec)

    # many-to-one: several OSM buildings claiming the same NYC footprint
    shared = sum(1 for i, c in used_nyc.items() if c > 1)
    stats["nyc_footprint_shared"] = shared
    stats["nyc_footprint_used"] = len(used_nyc)
    stats["nyc_footprint_unused"] = len(nycb) - len(used_nyc)

    # ---- write ------------------------------------------------------------
    cols = sorted({k for r in rows for k in r})
    order = ["building_id", "osm_id", "bin", "bbl", "bbl_mappluto",
             "bbl_source", "building_name",
             "address", "pluto_address", "district", "land_use",
             "building_class", "year_built", "number_of_floors",
             "roof_height", "nyc_height_roof", "height_source",
             "match_confidence", "match_distance_m", "match_area_ratio"]
    cols = order + [c for c in cols if c not in order]

    csv_path = os.path.join(OUTDIR, "building_registry.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    json_path = os.path.join(OUTDIR, "building_registry.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"count": len(rows), "columns": cols,
                   "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                              time.gmtime()),
                   "buildings": rows}, f)

    for name, data in (("review_unmatched.csv", unmatched),
                       ("review_ambiguous.csv", ambiguous)):
        if not data:
            continue
        p = os.path.join(OUTDIR, name)
        c2 = sorted({k for r in data for k in r})
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=c2, extrasaction="ignore")
            w.writeheader()
            for r in data:
                w.writerow(r)

    # ---- report -----------------------------------------------------------
    # The NYC extract is Manhattan-only, so context-borough buildings can never
    # match. Reporting a single percentage over all 56k rows understates the
    # join badly (79% vs 99%); report both, with Manhattan as the real figure.
    n = len(rows)
    matched = n - stats["no_nyc_match"]
    mn = [r for r in rows if not r.get("is_context")]
    n_mn = len(mn)
    mn_matched = sum(1 for r in mn if r.get("bin"))
    # bbl comes from the NYC footprint, so its presence does not prove a PLUTO
    # join. building_class is only ever set from a matched PLUTO lot.
    mn_pluto = sum(1 for r in mn if r.get("building_class"))
    report = {
        "osm_buildings": len(osm),
        "osm_buildings_manhattan": n_mn,
        "osm_buildings_context": n - n_mn,
        "nyc_footprints": len(nycb),
        "pluto_lots": len(pluto),
        "matched_to_nyc": matched,
        "matched_pct_all_rows": round(100.0 * matched / max(1, n), 2),
        "matched_manhattan": mn_matched,
        "matched_pct_manhattan": round(100.0 * mn_matched / max(1, n_mn), 2),
        "confidence": {k.replace("match_", ""): v for k, v in stats.items()
                       if k.startswith("match_")},
        "pluto_joined": stats["pluto_joined"],
        "pluto_joined_via_mappluto": stats["pluto_joined_via_mappluto"],
        "pluto_joined_pct_all_rows": round(
            100.0 * stats["pluto_joined"] / max(1, n), 2),
        "pluto_joined_manhattan": mn_pluto,
        "pluto_joined_pct_manhattan": round(
            100.0 * mn_pluto / max(1, n_mn), 2),
        "unmatched": stats["no_nyc_match"],
        "ambiguous": stats["ambiguous"],
        "nyc_footprint_used": stats["nyc_footprint_used"],
        "nyc_footprint_unused": stats["nyc_footprint_unused"],
        "nyc_footprint_shared": shared,
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "REGISTRY_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 78)
    for k, v in report.items():
        print("  %-24s %s" % (k, v))
    print("  registry -> %s" % os.path.relpath(csv_path, ROOT))
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
