"""
42_classify_architecture.py — Phase 2D foundation: architectural archetypes.

Runs on system Python. Reads the canonical registry, assigns each building an
architectural archetype, a roof archetype, a material family and a ground-floor
treatment, and writes the enriched registry back.

The classification is driven by real data, not guesswork:

  building_class   NYC's own taxonomy (A/B one-two family, C walk-up,
                   D elevator, K store, L loft, O office, H hotel, ...)
  year_built       PLUTO; Manhattan's median is 1910 so most stock is pre-war
  number_of_floors PLUTO
  land_use         PLUTO
  footprint area / proportions   from the OSM footprint
  district         derived in Phase 1

Where PLUTO is missing (context boroughs, 8% of Manhattan) the classifier
falls back to OSM tags + height + footprint, and records
`archetype_source = fallback` so the gap is visible rather than hidden.

Usage:  python scripts/phase2/42_classify_architecture.py
"""

import csv
import json
import math
import os
import sys
import time
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REG = os.path.join(ROOT, "data", "manhattan", "buildings")
DOCS = os.path.join(ROOT, "docs", "phase2")

# ---------------------------------------------------------------------------
# archetypes — the 22 the Phase 2 spec calls for
# ---------------------------------------------------------------------------
A_PREWAR_APT      = "prewar_masonry_apartment"
A_BROWNSTONE      = "brownstone_rowhouse"
A_CAST_IRON       = "cast_iron_commercial"
A_EARLY_TOWER     = "early_skyscraper_masonry"
A_ART_DECO        = "art_deco_tower"
A_BEAUX_ARTS      = "beaux_arts_civic"
A_POSTWAR_SLAB    = "postwar_office_slab"
A_MIDCENT_TOWER   = "midcentury_residential_tower"
A_GLASS_OFFICE    = "modern_glass_office"
A_LUX_RESI        = "contemporary_luxury_residential"
A_LOFT            = "industrial_loft"
A_WAREHOUSE       = "warehouse"
A_RETAIL_PODIUM   = "retail_podium"
A_MIXED_AVENUE    = "mixed_use_avenue"
A_HOTEL           = "hotel"
A_SCHOOL          = "school"
A_HOSPITAL        = "hospital"
A_PARKING         = "parking_structure"
A_RELIGIOUS       = "religious"
A_TRANSIT_UTIL    = "transit_utility"
A_PIER            = "pier_waterfront"
A_CONSTRUCTION    = "construction"

ALL_ARCHETYPES = [
    A_PREWAR_APT, A_BROWNSTONE, A_CAST_IRON, A_EARLY_TOWER, A_ART_DECO,
    A_BEAUX_ARTS, A_POSTWAR_SLAB, A_MIDCENT_TOWER, A_GLASS_OFFICE,
    A_LUX_RESI, A_LOFT, A_WAREHOUSE, A_RETAIL_PODIUM, A_MIXED_AVENUE,
    A_HOTEL, A_SCHOOL, A_HOSPITAL, A_PARKING, A_RELIGIOUS, A_TRANSIT_UTIL,
    A_PIER, A_CONSTRUCTION,
]

# archetype -> (material family, roof archetype, ground floor treatment)
ARCHETYPE_TRAITS = {
    A_PREWAR_APT:    ("brick_red",     "flat_parapet_cornice", "residential_entry"),
    A_BROWNSTONE:    ("brownstone",    "flat_cornice",         "stoop_entry"),
    A_CAST_IRON:     ("cast_iron",     "flat_cornice",         "storefront_tall"),
    A_EARLY_TOWER:   ("limestone",     "setback_crown",        "grand_entry"),
    A_ART_DECO:      ("buff_brick",    "deco_crown",           "grand_entry"),
    A_BEAUX_ARTS:    ("limestone",     "cornice_balustrade",   "grand_entry"),
    A_POSTWAR_SLAB:  ("concrete_grid", "flat_mech",            "plaza_entry"),
    A_MIDCENT_TOWER: ("white_brick",   "flat_mech",            "residential_entry"),
    A_GLASS_OFFICE:  ("curtain_glass", "flat_mech",            "glass_lobby"),
    A_LUX_RESI:      ("glass_stone",   "flat_mech",            "glass_lobby"),
    A_LOFT:          ("brick_dark",    "flat_parapet_cornice", "storefront_wide"),
    A_WAREHOUSE:     ("brick_dark",    "flat_parapet",         "loading_dock"),
    A_RETAIL_PODIUM: ("mixed_panel",   "flat_mech",            "storefront_wide"),
    A_MIXED_AVENUE:  ("brick_red",     "flat_parapet_cornice", "storefront_row"),
    A_HOTEL:         ("buff_brick",    "flat_parapet_cornice", "hotel_canopy"),
    A_SCHOOL:        ("brick_institutional", "flat_parapet",   "institutional_entry"),
    A_HOSPITAL:      ("buff_brick",    "flat_mech",            "institutional_entry"),
    A_PARKING:       ("concrete_open", "flat_open",            "garage_door"),
    A_RELIGIOUS:     ("stone_gothic",  "pitched_spire",        "church_door"),
    A_TRANSIT_UTIL:  ("concrete_grid", "flat_mech",            "service_door"),
    A_PIER:          ("steel_shed",    "shed_roof",            "loading_dock"),
    A_CONSTRUCTION:  ("scaffold",      "open_frame",           "hoarding"),
}


def num(v, d=None):
    try:
        if v in ("", None):
            return d
        return float(v)
    except Exception:
        return d


def office_lineage(yr, fl):
    """Commercial towers and blocks, by era. Shared by the PLUTO class path
    and the OSM-tag path so the two cannot drift apart."""
    if yr >= 1985:
        return A_GLASS_OFFICE
    if yr >= 1945:
        return A_POSTWAR_SLAB
    if yr >= 1925 and fl >= 18:
        return A_ART_DECO
    if fl >= 11:
        return A_EARLY_TOWER
    # A small pre-war commercial building is an avenue block, not a
    # Beaux-Arts monument. Beaux-Arts is reserved for the civic classes.
    return A_MIXED_AVENUE


def residential_lineage(yr, fl):
    """Multi-family residential, by era."""
    if yr >= 2000 and fl >= 15:
        return A_LUX_RESI
    if yr >= 1945:
        return A_MIDCENT_TOWER
    if yr >= 1925 and fl >= 18:
        return A_ART_DECO
    return A_PREWAR_APT


def classify(r):
    """Return (archetype, source). `source` records what drove the decision."""
    bc = (r.get("building_class") or "").strip().upper()
    fam = bc[:1]
    yr = num(r.get("year_built")) or num(r.get("nyc_year")) or 0
    fl = num(r.get("number_of_floors")) or 0
    h = num(r.get("roof_height")) or 0
    area = num(r.get("footprint_area")) or 0
    lu = (r.get("land_use") or "").strip()
    osmt = (r.get("osm_building_type") or "").strip().lower()
    name = (r.get("building_name") or "").lower()

    # floors from height when PLUTO has none
    if not fl and h:
        fl = max(1.0, round(h / 3.4))

    # ---- unambiguous functional classes from NYC building class ----------
    if fam == "G":
        return A_PARKING, "bldgclass"
    if fam == "M":
        return A_RELIGIOUS, "bldgclass"
    if fam == "W":
        return A_SCHOOL, "bldgclass"
    if fam == "I":
        return A_HOSPITAL, "bldgclass"
    if fam == "H":
        return A_HOTEL, "bldgclass"
    if fam in ("T", "U"):
        return A_TRANSIT_UTIL, "bldgclass"
    if fam == "E":
        return A_WAREHOUSE, "bldgclass"
    if fam == "F":
        return (A_LOFT if yr and yr < 1940 else A_WAREHOUSE), "bldgclass"

    # ---- OSM fallbacks where PLUTO is absent ------------------------------
    if not bc:
        if osmt in ("church", "cathedral", "chapel", "synagogue", "mosque",
                    "temple"):
            return A_RELIGIOUS, "osm_tag"
        if osmt in ("school", "university", "college"):
            return A_SCHOOL, "osm_tag"
        if osmt == "hospital":
            return A_HOSPITAL, "osm_tag"
        if osmt == "hotel":
            return A_HOTEL, "osm_tag"
        if osmt in ("warehouse", "industrial", "factory"):
            return A_WAREHOUSE, "osm_tag"
        if osmt in ("train_station", "transportation"):
            return A_TRANSIT_UTIL, "osm_tag"
        if osmt in ("garage", "garages", "parking"):
            return A_PARKING, "osm_tag"
        # New construction is exactly what PLUTO is missing -- a 2020 supertall
        # gets a BIN and a BBL but no lot record yet, so without this the
        # tallest towers in the city fall through to the geometry ladder.
        # Citigroup Center, Central Park Tower, One Manhattan West and 35
        # Hudson Yards all landed here.
        if osmt in ("office", "commercial"):
            return office_lineage(yr, fl), "osm_tag+year+floors"
        if osmt in ("apartments", "residential", "house", "detached"):
            return residential_lineage(yr, fl), "osm_tag+year+floors"
        if osmt in ("retail", "supermarket", "kiosk"):
            return (A_RETAIL_PODIUM if fl <= 3 else A_MIXED_AVENUE), "osm_tag"

    if "pier" in name or "terminal" in name:
        return A_PIER, "name"
    if osmt == "construction":
        return A_CONSTRUCTION, "osm_tag"

    # ---- office lineage ---------------------------------------------------
    if fam == "O" or lu == "5":
        return office_lineage(yr, fl), "bldgclass+year+floors"

    # ---- store / loft / mixed --------------------------------------------
    if fam == "L":
        return (A_CAST_IRON if yr and yr < 1905 else A_LOFT), "bldgclass+year"
    if fam == "K":
        if yr and yr < 1905 and 3 <= fl <= 7:
            return A_CAST_IRON, "bldgclass+year+floors"
        return (A_RETAIL_PODIUM if fl <= 3 else A_MIXED_AVENUE), "bldgclass"
    if fam == "S":
        return A_MIXED_AVENUE, "bldgclass"

    # ---- residential lineage ---------------------------------------------
    if fam in ("A", "B"):
        return A_BROWNSTONE, "bldgclass"
    if fam == "C":
        # NYC class C is *walk-up apartments*, which in Manhattan means the
        # tenement stock -- not brownstones. The sub-class separates the two
        # cleanly, and the measured geometry confirms it (Manhattan medians):
        #
        #   C0 three families      90 m2 / 3 fl   rowhouse, subdivided
        #   C3 four families       90 m2 / 3 fl   rowhouse, subdivided
        #   C2 five-six families  102 m2 / 4 fl   borderline
        #   C5 converted dwelling 116 m2 / 4 fl   rowhouse, converted
        #   C1 over six families  187 m2 / 5 fl   tenement
        #   C4 old-law tenement   166 m2 / 5 fl   tenement (definitionally)
        #   C6/C8 walk-up co-op   157 m2 / 5 fl   tenement
        #   C7 walk-up + stores   174 m2 / 5 fl   tenement over storefronts
        #
        # B-class (two-family) medians are 86-89 m2 / 3 fl, so C0/C3 are
        # geometrically indistinguishable from the rowhouses next to them.
        if bc in ("C0", "C3"):
            return A_BROWNSTONE, "bldgclass_sub"
        if bc in ("C2", "C5") and area and area < 160 and fl <= 5:
            return A_BROWNSTONE, "bldgclass_sub+floors+area"
        if bc == "C7":
            # walk-up apartments over stores: a mixed-use avenue frontage
            return A_MIXED_AVENUE, "bldgclass_sub"
        return A_PREWAR_APT, "bldgclass"
    if fam in ("D", "R"):
        return residential_lineage(yr, fl), "bldgclass+year+floors"

    # ---- civic / assembly -------------------------------------------------
    if fam in ("N", "P", "Q", "J", "Y", "Z"):
        return A_BEAUX_ARTS, "bldgclass"

    # ---- last resort: geometry + era -------------------------------------
    src = "geometry"
    # Tower scale. The era decides the style, not the height: gating the
    # modern eras at 150 m sent every 90-150 m post-war tower to
    # early_skyscraper_masonry, which is a limestone-and-setback archetype.
    # 152 tall buildings were mislabelled that way, Citigroup Center included.
    if h >= 90 or fl >= 25:
        if yr >= 1985:
            return A_GLASS_OFFICE, src
        if yr >= 1945:
            return A_POSTWAR_SLAB, src
        if yr >= 1925:
            return A_ART_DECO, src
        if yr:
            return A_EARLY_TOWER, src
        # No year at all on something this tall means no lot record, and a
        # missing lot record almost always means recent construction --
        # 30 Hudson Yards arrives here.
        return (A_GLASS_OFFICE if h >= 150 else A_EARLY_TOWER), src
    # A footprint of 30,000 m2 is about two city blocks of floor plate — no
    # apartment or office building is that wide. These are horizontal
    # facilities: convention centers and museums when named, otherwise plain
    # logistics sheds. Javits (86,000 m2) was falling through to
    # prewar_masonry_apartment (P2-026).
    if area >= 30000:
        return (A_BEAUX_ARTS if name else A_WAREHOUSE), src
    if fl <= 2 and area and area > 900:
        return A_WAREHOUSE, src
    # measured: Manhattan rowhouse footprints are 85-120 m2 (a 25 ft lot).
    # 260 was too generous and pulled in tenement-scale blocks.
    if fl <= 5 and area and area < 150:
        return A_BROWNSTONE, src
    if yr and yr >= 1985:
        return A_MIDCENT_TOWER, src
    return A_PREWAR_APT, src


def main():
    t0 = time.time()
    src = os.path.join(REG, "building_registry.csv")
    if not os.path.exists(src):
        print("no registry; run 41_build_registry.py first")
        return 2

    rows = list(csv.DictReader(open(src, encoding="utf-8")))
    counts = Counter()
    sources = Counter()
    mn_counts = Counter()
    n_mn = 0

    for r in rows:
        a, s = classify(r)
        mat, roof, ground = ARCHETYPE_TRAITS[a]
        r["facade_archetype"] = a
        r["archetype_source"] = s
        r["material_family"] = mat
        r["roof_archetype"] = roof
        r["ground_floor_archetype"] = ground
        # storefront slots: only where a storefront treatment makes sense
        r["storefront_slots"] = (
            1 if ground in ("storefront_tall", "storefront_wide",
                            "storefront_row") else 0)
        counts[a] += 1
        sources[s] += 1
        # Context-borough buildings have no PLUTO, so they are all fallback
        # classified and swamp the distribution. Report Manhattan separately;
        # that is the number to sanity-check against the real city.
        if (r.get("is_context") or "").strip().lower() not in ("1", "true",
                                                               "yes"):
            mn_counts[a] += 1
            n_mn += 1

    cols = list(rows[0].keys())
    with open(src, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    report = {
        "buildings": len(rows),
        "buildings_manhattan": n_mn,
        "archetypes_used": len(counts),
        "archetypes_defined": len(ALL_ARCHETYPES),
        "distribution": dict(counts.most_common()),
        "distribution_manhattan": dict(mn_counts.most_common()),
        "decision_source": dict(sources.most_common()),
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "ARCHETYPE_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("=" * 78)
    print("PHASE 2D  ARCHITECTURAL CLASSIFICATION")
    print("=" * 78)
    print("  buildings classified : %d" % len(rows))
    print("  archetypes used      : %d of %d defined"
          % (len(counts), len(ALL_ARCHETYPES)))
    print("-" * 78)
    print("    %-34s %6s %6s | %6s %6s"
          % ("archetype", "all", "%", "MN", "%"))
    for a, c in counts.most_common():
        m = mn_counts.get(a, 0)
        print("    %-34s %6d %5.1f%% | %6d %5.1f%%"
              % (a, c, 100.0 * c / len(rows), m,
                 100.0 * m / n_mn if n_mn else 0.0))
    print("-" * 78)
    print("  decided by:")
    for s, c in sources.most_common():
        print("    %-34s %6d  %5.1f%%" % (s, c, 100.0 * c / len(rows)))
    unused = [a for a in ALL_ARCHETYPES if a not in counts]
    if unused:
        print("  unused archetypes    : %s" % unused)
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
