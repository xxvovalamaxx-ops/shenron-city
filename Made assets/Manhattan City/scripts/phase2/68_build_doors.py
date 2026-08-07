"""
68_build_doors.py -- Phase 3B: the doorway config, generated from data.

    python scripts/phase2/68_build_doors.py [--expansion]

The runtime's door system (apps/manhattan-threejs/src/doors.js) is
data-driven: it reads data/doors/doors.json and treats every entry the same
way. Nothing about a building is hard-coded in the runtime. This script is
what writes that file, so the Phase 3B pipeline has one source of truth.

Mode 1 (default) -- the hero corridor buildings. Five corridor rooms sit in
four buildings (the penthouse and the home lobby share Central Park Tower,
and Floor 45 shares the HQ with its lobby), so the config carries four
doorways, each anchored to the interior room it leads into. The runtime
derives the wall plane, the cut rectangle and the assembly from the room;
the generator only has to say which room.

Mode 2 (--expansion) -- the ~660 entrance-treatment candidates. These are
buildings with a retail ground floor (storefront_slots or a retail ground
floor archetype) or within a short walk of a subway entrance. Their entries
carry explicit world anchors (x, y, yaw, width, height) computed from the
registry's footprint frontage, because most of them have no interior room
yet. That mode is the data path for Phase 3B's next gate; it is not enabled
by default and the runtime's 'entrance' kind is documented but not built
until the five-doorway pipeline passes its acceptance checks.

Nothing here touches the frozen world: it reads the registry and the subway
placement JSON and writes one small config file.
"""

import argparse
import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))))
REG = os.path.join(ROOT, "data", "manhattan", "buildings", "building_registry.csv")
SUBWAY = os.path.join(ROOT, "data", "manhattan", "subway", "subway.json")
STREETS = os.path.join(ROOT, "data", "manhattan", "streets",
                       "street_graph.json")
# The runtime reads doors.json and nothing else. The expansion set goes to its
# own file on purpose: --expansion used to overwrite doors.json, which would
# have handed the runtime ~660 entrance entries with no interior behind them
# -- holes into solid buildings, and the gate this phase is built around
# bypassed by running a generator with a flag.
OUT = os.path.join(ROOT, "data", "manhattan", "doors", "doors.json")
OUT_EXPANSION = os.path.join(ROOT, "data", "manhattan", "doors",
                             "doors_expansion.json")

# The four buildings the hero corridor's five rooms sit in. Each entry names
# the interior room the doorway leads to; the runtime derives the wall cut
# and the assembly from that room's position and facing.
CORRIDOR_DOORS = [
    {"key": "home_lobby", "bid": 20263, "kind": "wall", "room": "home_lobby",
     "note": "Central Park Tower — penthouse and home lobby share this building"},
    {"key": "bodega", "bid": 14513, "kind": "wall", "room": "bodega",
     "note": "corner market on the corridor's drive route"},
    {"key": "tower_lobby", "bid": 19990, "kind": "wall", "room": "lobby",
     "note": "the Torch, 740 8th Avenue — the anchored tower lobby"},
    {"key": "hq_lobby", "bid": 34686, "kind": "recess", "room": "hq_lobby",
     "note": "HQ podium recess — an authored opening, no wall cut needed"},
]

# Ground floor archetypes that make a building a retail-storefront candidate
# (measured against the registry; the facade shader's `retail` test mirrors
# these: ground == 12/13/14 in the classifier's table).
RETAIL_GROUND = {
    "storefront_row", "storefront_tall", "storefront_wide", "glass_lobby",
}

# The HANDOFF's "approximately 660 buildings" is the subway tranche: 658
# entrance kiosks in data/manhattan/subway/subway.json, and every registry
# building within this radius of one. Measured: 631 buildings at 30 m (284 at
# 20 m, 480 at 25 m, 1,053 at 40 m). 631 is the number the HANDOFF is
# approximating, and it is the *default* expansion set.
#
# The retail-ground-floor set is a different, much larger tranche -- 12,834
# buildings measured, union 13,125 -- so it is behind --include-retail rather
# than folded in. Emitting 13,125 rows under a heading that says "~660" is
# how a 20x scope overrun gets waved through.
SUBMETRO_RADIUS_M = 30.0
GRID_M = 30.0


def load_rows():
    rows = []
    with open(REG, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return rows


def load_subway():
    try:
        with open(SUBWAY, encoding="utf-8") as f:
            d = json.load(f)
        return d.get("entrances") or []
    except FileNotFoundError:
        return []


def load_streets():
    """Drivable centreline segments as (mx, my, dx, dy), for frontage yaw."""
    try:
        with open(STREETS, encoding="utf-8") as f:
            d = json.load(f)
    except FileNotFoundError:
        return []
    segs = []
    for e in d.get("edges", ()):
        if not e.get("drivable"):
            continue
        pts = e.get("pts") or ()
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            segs.append(((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5,
                         b[0] - a[0], b[1] - a[1]))
    return segs


def grid_index(items, key):
    """Bucket items into GRID_M cells for nearest-neighbour queries. 56k
    buildings against 658 entrances and 100k street segments is not a job for
    an O(n*m) scan, and there is no numpy or scipy in this pipeline by
    design."""
    cells = {}
    for it in items:
        x, y = key(it)
        cells.setdefault((int(x // GRID_M), int(y // GRID_M)), []).append(it)
    return cells


def nearest(cells, key, x, y, max_r):
    """Nearest item to (x, y) within max_r, searching outward by cell ring."""
    best = None
    best_d = max_r * max_r
    rings = int(max_r // GRID_M) + 1
    cx, cy = int(x // GRID_M), int(y // GRID_M)
    for dx in range(-rings, rings + 1):
        for dy in range(-rings, rings + 1):
            for it in cells.get((cx + dx, cy + dy), ()):
                ix, iy = key(it)
                d = (ix - x) ** 2 + (iy - y) ** 2
                if d < best_d:
                    best_d = d
                    best = it
    return best, (math.sqrt(best_d) if best is not None else None)


def frontage_yaw(street_cells, x, y):
    """Yaw such that the doorway's +x points away from the nearest drivable
    centreline -- the same rule interiors._streetFacing uses for the corridor
    rooms, so an entrance faces the street it fronts rather than an arbitrary
    wall. Returns (yaw, distance_m) or (None, None) when no street is near."""
    seg, dist = nearest(street_cells, lambda s: (s[0], s[1]), x, y, 200.0)
    if seg is None:
        return None, None
    dx = x - seg[0]
    dz = -(y - seg[1])
    return round(math.atan2(-dz, dx), 4), round(dist, 1)


def expansion_entries(rows, entrances, streets, include_retail):
    """Entrance-treatment candidates, with explicit world anchors.

    Each entry carries the building id, the anchor the runtime would resolve a
    wall from, and the frontage yaw measured off the street graph. There is no
    interior room behind any of them, which is exactly why this file is not
    the one the runtime reads: an entrance with no room is a hole into a solid
    building.
    """
    ent_cells = grid_index(entrances, lambda e: (e["x"], e["y"]))
    st_cells = grid_index(streets, lambda s: (s[0], s[1]))
    out = []
    for r in rows:
        if r.get("is_context") == "1":
            continue
        bid = int(r["building_id"])
        ground = (r.get("ground_floor_archetype") or "").lower()
        x = float(r["x_m"])
        y = float(r["y_m"])
        kiosk, kiosk_d = nearest(ent_cells, lambda e: (e["x"], e["y"]),
                                 x, y, SUBMETRO_RADIUS_M)
        retail = ground in RETAIL_GROUND
        if kiosk is None and not (retail and include_retail):
            continue
        tranche = "subway" if kiosk is not None else "retail"
        yaw, street_d = frontage_yaw(st_cells, x, y)
        # the kiosk's own yaw is the better hint where there is one: it was
        # placed against the pavement it stands on
        if kiosk is not None and kiosk.get("yaw") is not None:
            yaw = round(float(kiosk["yaw"]), 4)
        out.append({
            "key": "ent_%05d" % bid,
            "bid": bid,
            "kind": "entrance",
            "room": None,
            "tranche": tranche,
            "anchor": {"x": round(x, 1), "y": round(y, 1), "yaw": yaw},
            "streetDist_m": street_d,
            "kioskDist_m": None if kiosk_d is None else round(kiosk_d, 1),
            "retailGround": retail,
            "groundArchetype": ground or None,
            "width": 2.2,
            "height": 2.5,
        })
    out.sort(key=lambda d: d["bid"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--expansion", action="store_true",
                    help="emit the ~660 subway-tranche entrance-treatment "
                         "candidates (documented data path; never read by "
                         "the runtime)")
    ap.add_argument("--include-retail", action="store_true",
                    help="also emit the retail-ground-floor tranche "
                         "(12,834 more buildings; a separate, later gate)")
    args = ap.parse_args()

    rows = load_rows()
    by_id = {int(r["building_id"]): r for r in rows}

    out_path = OUT
    if args.expansion:
        out_path = OUT_EXPANSION
        entrances = load_subway()
        streets = load_streets()
        entries = expansion_entries(rows, entrances, streets,
                                    args.include_retail)
        subway_n = sum(1 for e in entries if e["tranche"] == "subway")
        doc = ("entrance-treatment candidates: %d buildings within %.0f m of "
               "one of the %d subway entrances (this is the HANDOFF's "
               "'approximately 660')%s. Anchors and frontage yaw are measured "
               "from the registry, the subway placement and the street graph. "
               "The runtime never reads this file: it is the Phase 3B "
               "expansion path, and every entry still needs an interior room "
               "behind it, or an entrance is a hole into a solid building."
               % (subway_n, SUBMETRO_RADIUS_M, len(entrances),
                  (", plus %d retail-ground-floor buildings"
                   % (len(entries) - subway_n)) if args.include_retail
                  else " (retail tranche excluded; --include-retail adds it)"))
    else:
        missing = [d["bid"] for d in CORRIDOR_DOORS if d["bid"] not in by_id]
        if missing:
            print("!! corridor bids missing from the registry:", missing)
            return 1
        entries = CORRIDOR_DOORS
        doc = "the buildings the hero corridor touches (5 rooms, 4 buildings)"

    cfg = {
        "schemaVersion": 1,
        "generatedBy": "scripts/phase2/68_build_doors.py",
        "scope": doc,
        "groundLevel": 12.0,
        "runtimeEnabled": not args.expansion,
        "doors": entries,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)

    kinds = {}
    tranches = {}
    for d in entries:
        kinds[d["kind"]] = kinds.get(d["kind"], 0) + 1
        if d.get("tranche"):
            tranches[d["tranche"]] = tranches.get(d["tranche"], 0) + 1
    print("wrote %s" % out_path)
    print("  %d doorways: %s" % (len(entries),
          ", ".join("%s x %s" % (k, v) for k, v in sorted(kinds.items()))))
    if tranches:
        print("  by tranche: %s" % ", ".join(
            "%s x %s" % (k, v) for k, v in sorted(tranches.items())))
    if args.expansion:
        anchored = sum(1 for d in entries
                       if d["anchor"]["yaw"] is not None)
        print("  %d/%d have a measured frontage yaw" % (anchored, len(entries)))
        print("  NOT read by the runtime. doors.json is untouched; enabling "
              "these needs an interior room behind each entrance.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
