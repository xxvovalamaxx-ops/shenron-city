"""
44_build_cells.py -- Phase 2C: runtime cell grid and LOD ladder.

Defines the spatial units the Three.js runtime streams. Nothing here touches
geometry; it assigns every building to a cell and a sector, computes the
budgets each unit implies, and writes a manifest the runtime can load in one
request before it fetches anything heavy.

Grid
    cell    200 m   atomic streaming unit, carries LOD 0 and 1
    sector  800 m   4x4 cells, carries LOD 2 and 3
    city            one merged silhouette, LOD 4

LOD ladder
    L0  full facade detail, storefronts, entrances, roof clutter   0 - 250 m
    L1  facade texture, cornice/parapet, roof mechanicals        250 - 700 m
    L2  extruded massing with a baked facade atlas               700 - 2000 m
    L3  extruded massing, flat material per family              2000 - 6000 m
    L4  merged silhouette, tall buildings only                    6000 m +

Tall buildings are pinned: anything at or above PIN_HEIGHT stays in the far
mesh regardless of which cell it belongs to, so the skyline does not pop out
when its cell unloads.

Writes
    data/manhattan/cells/cell_manifest.json   runtime spatial index
    data/manhattan/cells/cell_buildings.json  cell id -> building ids
    building_registry.csv                     + cell_id, sector_id, pinned
    docs/phase2/CELL_REPORT.json

Usage:  python scripts/phase2/44_build_cells.py
"""

import csv
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REG = os.path.join(ROOT, "data", "manhattan", "buildings")
OUT = os.path.join(ROOT, "data", "manhattan", "cells")
DOCS = os.path.join(ROOT, "docs", "phase2")

CELL = 200.0            # m, atomic streaming unit
SECTOR = 800.0          # m, 4x4 cells
PIN_HEIGHT = 100.0      # m, above this a building is always in the far mesh

# LOD ladder: (name, near m, far m, unit, triangles per building)
# The triangle figures are budgets, not measurements -- they are what the
# facade generator in Phase 2D is allowed to spend. CELL_REPORT.json turns
# them into per-cell totals so an over-budget cell is visible before any
# geometry exists.
LODS = [
    ("L0", 0.0,    250.0,  "cell",   900),
    ("L1", 250.0,  700.0,  "cell",   180),
    ("L2", 700.0,  2000.0, "sector",  40),
    ("L3", 2000.0, 6000.0, "sector",  26),
    ("L4", 6000.0, 40000.0, "city",   12),
]

# A cell that needs more than this at L0 will not hold 60 fps on a mid GPU
# once it is one of several resident cells. Flagged, not silently accepted.
CELL_TRI_BUDGET_L0 = 120000


def cell_key(x, y, size):
    return (int(math.floor(x / size)), int(math.floor(y / size)))


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    src = os.path.join(REG, "building_registry.csv")
    if not os.path.exists(src):
        print("no registry; run 41_build_registry.py first")
        return 2
    rows = list(csv.DictReader(open(src, encoding="utf-8")))

    cells = defaultdict(lambda: {
        "n": 0, "n_mn": 0, "pinned": 0, "verts": 0, "h_max": 0.0,
        "area": 0.0,
        "x0": 1e18, "y0": 1e18, "x1": -1e18, "y1": -1e18,
        "arche": Counter(), "ids": [],
    })
    sectors = defaultdict(lambda: {"n": 0, "cells": set(), "h_max": 0.0})
    n_pinned = 0

    for r in rows:
        x = float(r.get("x_m") or 0.0)
        y = float(r.get("y_m") or 0.0)
        h = float(r.get("roof_height") or 0.0)
        v = int(r.get("footprint_verts") or 0)
        a = float(r.get("footprint_area") or 0.0)
        ctx = str(r.get("is_context") or "0") not in ("0", "")

        cx, cy = cell_key(x, y, CELL)
        sx, sy = cell_key(x, y, SECTOR)
        cid = "c_%d_%d" % (cx, cy)
        sid = "s_%d_%d" % (sx, sy)
        pinned = 1 if h >= PIN_HEIGHT else 0
        n_pinned += pinned

        r["cell_id"] = cid
        r["sector_id"] = sid
        r["pinned"] = pinned

        c = cells[cid]
        c["n"] += 1
        if not ctx:
            c["n_mn"] += 1
        c["pinned"] += pinned
        c["verts"] += v
        c["area"] += a
        c["h_max"] = max(c["h_max"], h)
        c["x0"] = min(c["x0"], x); c["x1"] = max(c["x1"], x)
        c["y0"] = min(c["y0"], y); c["y1"] = max(c["y1"], y)
        c["arche"][r.get("facade_archetype") or "?"] += 1
        c["ids"].append(int(r["building_id"]))
        c["cx"], c["cy"] = cx, cy
        c["sector"] = sid

        s = sectors[sid]
        s["n"] += 1
        s["cells"].add(cid)
        s["h_max"] = max(s["h_max"], h)

    # ---- manifest ---------------------------------------------------------
    lod_tris = {name: tpb for name, _, _, _, tpb in LODS}
    over = []
    manifest_cells = {}
    for cid, c in sorted(cells.items()):
        tri_l0 = c["n"] * lod_tris["L0"]
        if tri_l0 > CELL_TRI_BUDGET_L0:
            over.append((cid, c["n"], tri_l0))
        manifest_cells[cid] = {
            "cx": c["cx"], "cy": c["cy"],
            "sector": c["sector"],
            # the cell's grid footprint, not the building extent, so the
            # runtime can frustum-test before anything is loaded
            "bounds": [c["cx"] * CELL, c["cy"] * CELL,
                       (c["cx"] + 1) * CELL, (c["cy"] + 1) * CELL],
            "h_max": round(c["h_max"], 1),
            "n": c["n"],
            "n_manhattan": c["n_mn"],
            "n_pinned": c["pinned"],
            "footprint_verts": c["verts"],
            "built_area_m2": round(c["area"]),
            "tri_budget": {n: c["n"] * t for n, t in lod_tris.items()},
            "dominant_archetype": c["arche"].most_common(1)[0][0],
        }

    manifest = {
        "generated_by": "scripts/phase2/44_build_cells.py",
        "grid": {"cell_m": CELL, "sector_m": SECTOR,
                 "pin_height_m": PIN_HEIGHT},
        "lods": [{"name": n, "near_m": a, "far_m": b, "unit": u,
                  "tri_per_building": t} for n, a, b, u, t in LODS],
        "counts": {
            "buildings": len(rows),
            "cells": len(cells),
            "sectors": len(sectors),
            "pinned": n_pinned,
        },
        "cells": manifest_cells,
        "sectors": {sid: {"n": s["n"], "cells": sorted(s["cells"]),
                          "h_max": round(s["h_max"], 1)}
                    for sid, s in sorted(sectors.items())},
    }
    with open(os.path.join(OUT, "cell_manifest.json"), "w",
              encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"))

    with open(os.path.join(OUT, "cell_buildings.json"), "w",
              encoding="utf-8") as f:
        json.dump({cid: sorted(c["ids"]) for cid, c in sorted(cells.items())},
                  f, separators=(",", ":"))

    cols = list(rows[0].keys())
    for c in ("cell_id", "sector_id", "pinned"):
        if c not in cols:
            cols.append(c)
    with open(src, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)

    # ---- report -----------------------------------------------------------
    per = sorted(c["n"] for c in cells.values())
    def pct(p):
        return per[min(len(per) - 1, int(len(per) * p))]

    total_tris = {n: sum(c["n"] for c in cells.values()) * t
                  for n, t in lod_tris.items()}

    # ---- resident-set probe ----------------------------------------------
    # Citywide totals say nothing about frame cost. What matters is how many
    # triangles are resident when the camera stands in one place. Put the
    # camera at the centre of every occupied Manhattan cell in turn, walk the
    # LOD ladder outward, and sum. This is the number that decides whether
    # the ladder works, so it is measured rather than assumed.
    #
    # No frustum culling is applied: this is the worst case, a camera that
    # can see in every direction.
    cell_list = [(c["cx"], c["cy"], c["n"], c["pinned"])
                 for c in cells.values()]
    by_key = {(cx, cy): (n, p) for cx, cy, n, p in cell_list}
    sector_n = {sid: s["n"] for sid, s in sectors.items()}

    l0_far = LODS[0][2]
    l1_far = LODS[1][2]
    l2_far = LODS[2][2]
    l3_far = LODS[3][2]
    t_l0, t_l1, t_l2, t_l3, t_l4 = (l[4] for l in LODS)

    r0 = int(math.ceil(l0_far / CELL))
    r1 = int(math.ceil(l1_far / CELL))
    rs2 = int(math.ceil(l2_far / SECTOR))
    rs3 = int(math.ceil(l3_far / SECTOR))
    total_buildings = len(rows)

    resident = []
    for cx, cy, n, _p in cell_list:
        if n < 2:
            continue
        tris = 0
        seen_cells = set()
        # L0 / L1 rings, by cell
        for dx in range(-r1, r1 + 1):
            for dy in range(-r1, r1 + 1):
                k = (cx + dx, cy + dy)
                hit = by_key.get(k)
                if not hit:
                    continue
                d = math.hypot(dx, dy) * CELL
                if d > l1_far:
                    continue
                seen_cells.add(k)
                tris += hit[0] * (t_l0 if d <= l0_far else t_l1)
        # L2 / L3 rings, by sector, excluding what the cell rings already hold
        sx, sy = cx // 4, cy // 4
        for dx in range(-rs3, rs3 + 1):
            for dy in range(-rs3, rs3 + 1):
                sid = "s_%d_%d" % (sx + dx, sy + dy)
                sn = sector_n.get(sid)
                if not sn:
                    continue
                d = math.hypot(dx, dy) * SECTOR
                if d > l3_far or d <= l1_far:
                    continue
                tris += sn * (t_l2 if d <= l2_far else t_l3)
        # L4: everything else as a merged silhouette
        tris += total_buildings * t_l4 // 8
        resident.append(tris)

    resident.sort()

    def rpct(p):
        return resident[min(len(resident) - 1, int(len(resident) * p))] \
            if resident else 0

    report = {
        "buildings": len(rows),
        "cells_occupied": len(cells),
        "sectors_occupied": len(sectors),
        "cell_m": CELL,
        "sector_m": SECTOR,
        "pinned_buildings": n_pinned,
        "pin_height_m": PIN_HEIGHT,
        "buildings_per_cell": {
            "min": per[0], "p50": pct(0.5), "p90": pct(0.9),
            "p99": pct(0.99), "max": per[-1],
            "mean": round(len(rows) / len(cells), 1),
        },
        "citywide_tri_budget": total_tris,
        "resident_tris_per_camera": {
            "samples": len(resident),
            "p50": rpct(0.5), "p90": rpct(0.9), "p99": rpct(0.99),
            "max": resident[-1] if resident else 0,
            "note": ("worst case, no frustum culling; camera placed at the "
                     "centre of every occupied cell with 2+ buildings"),
        },
        "cells_over_l0_budget": len(over),
        "worst_cells": [{"cell": c, "n": n, "tri_l0": t}
                        for c, n, t in sorted(over, key=lambda z: -z[2])[:10]],
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "CELL_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("=" * 74)
    print("PHASE 2C  RUNTIME CELL GRID")
    print("=" * 74)
    print("  buildings            : %d" % len(rows))
    print("  cells occupied       : %d  (%.0f m)" % (len(cells), CELL))
    print("  sectors occupied     : %d  (%.0f m)" % (len(sectors), SECTOR))
    print("  pinned (>= %.0f m)    : %d" % (PIN_HEIGHT, n_pinned))
    print("-" * 74)
    b = report["buildings_per_cell"]
    print("  buildings per cell   : min %d  p50 %d  p90 %d  p99 %d  max %d"
          % (b["min"], b["p50"], b["p90"], b["p99"], b["max"]))
    print("-" * 74)
    print("  %-4s %7s %8s %-7s %12s  %s"
          % ("lod", "near", "far", "unit", "tri/bldg", "citywide tris"))
    for n, near, far, unit, t in LODS:
        print("  %-4s %6.0fm %7.0fm %-7s %12d  %s"
              % (n, near, far, unit, t, "{:,}".format(total_tris[n])))
    print("-" * 74)
    rr = report["resident_tris_per_camera"]
    print("  resident tris at one camera position (no frustum culling):")
    print("      p50 %s   p90 %s   p99 %s   max %s"
          % tuple("{:,}".format(rr[k]) for k in ("p50", "p90", "p99", "max")))
    print("-" * 74)
    if over:
        print("  cells over the %s tri L0 budget: %d"
              % ("{:,}".format(CELL_TRI_BUDGET_L0), len(over)))
        for c, n, t in sorted(over, key=lambda z: -z[2])[:6]:
            print("      %-14s %4d buildings  %s tris"
                  % (c, n, "{:,}".format(t)))
    else:
        print("  no cell exceeds the L0 triangle budget")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
