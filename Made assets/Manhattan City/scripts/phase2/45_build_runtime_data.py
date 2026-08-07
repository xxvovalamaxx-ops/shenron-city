"""
45_build_runtime_data.py -- Phase 2C: compact data payload for the browser.

The registry CSV is ~20 MB and is the authoring artefact, not a runtime one.
This emits what the Three.js app actually needs, split by how it is used:

  city.json      small, loaded first: projection, grid, LOD ladder, tile list,
                 district and archetype tables, world bounds
  core.bin       one flat binary of per-building numbers, index = building_id
  text.json      names and addresses, only for the buildings that have them

core.bin layout, little-endian, 20 bytes per building:

    offset  type   field
    0       f32    x_m
    4       f32    y_m
    8       f32    roof_height
    12      u8     archetype index into city.archetypes
    13      u8     district index into city.districts
    14      u8     lod tier index into city.tiers
    15      u8     flags   bit0 pinned, bit1 is_context, bit2 has_text
    16      u16    year_built, 0 if unknown
    18      u8     floors, 255 if unknown or above 254
    19      u8     match confidence index into city.confidence

Reading it in the browser is one fetch and one DataView pass, no parsing.

Usage:  python scripts/phase2/45_build_runtime_data.py
"""

import csv
import json
import os
import re
import struct
import sys
import time
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REG = os.path.join(ROOT, "data", "manhattan", "buildings")
CELLS = os.path.join(ROOT, "data", "manhattan", "cells")
OUT = os.path.join(ROOT, "data", "manhattan", "runtime")
EXPORTS = os.path.join(ROOT, "exports")
DOCS = os.path.join(ROOT, "docs", "phase2")

REC = 20  # bytes per building
TIERS = ["block", "district", "skyline", "landmark"]
CONF = ["none", "low", "medium", "high"]

TILE_RE = re.compile(r"^manhattan_([+-]\d+)_([+-]\d+)\.glb$")
STREET_RE = re.compile(r"^streets_([+-]\d+)_([+-]\d+)\.glb$")


def num(v, d=0.0):
    try:
        return float(v) if str(v).strip() != "" else d
    except (TypeError, ValueError):
        return d


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    src = os.path.join(REG, "building_registry.csv")
    if not os.path.exists(src):
        print("no registry; run 41_build_registry.py first")
        return 2
    rows = list(csv.DictReader(open(src, encoding="utf-8")))
    rows.sort(key=lambda r: int(r["building_id"]))

    # building_id must be a dense 0..n-1 index or the binary layout breaks
    for i, r in enumerate(rows):
        if int(r["building_id"]) != i:
            print("building_id is not dense at index %d (got %s) -- the "
                  "binary layout assumes index == building_id"
                  % (i, r["building_id"]))
            return 3

    archetypes = sorted({r.get("facade_archetype") or "" for r in rows})
    districts = sorted({r.get("district") or "" for r in rows})

    # archetype -> (material family, roof, ground floor). The classifier already
    # decided these per row; collapsing them to a table keeps the payload small
    # and lets the facade shader look them up from the archetype index alone.
    traits = {}
    for r in rows:
        a = r.get("facade_archetype") or ""
        if a and a not in traits:
            traits[a] = [r.get("material_family") or "",
                         r.get("roof_archetype") or "",
                         r.get("ground_floor_archetype") or ""]
    materials = sorted({v[0] for v in traits.values()})
    roofs = sorted({v[1] for v in traits.values()})
    grounds = sorted({v[2] for v in traits.values()})
    if len(archetypes) > 255 or len(districts) > 255:
        print("too many archetypes/districts for a u8 index")
        return 3
    a_ix = {a: i for i, a in enumerate(archetypes)}
    d_ix = {d: i for i, d in enumerate(districts)}
    t_ix = {t: i for i, t in enumerate(TIERS)}
    c_ix = {c: i for i, c in enumerate(CONF)}

    buf = bytearray(REC * len(rows))
    text = {}
    stats = Counter()

    for i, r in enumerate(rows):
        name = (r.get("building_name") or "").strip()
        addr = (r.get("address") or "").strip()
        has_text = bool(name or addr)
        if has_text:
            text[str(i)] = [name, addr]

        flags = 0
        if str(r.get("pinned") or "0") not in ("0", ""):
            flags |= 1
        if str(r.get("is_context") or "0") not in ("0", ""):
            flags |= 2
        if has_text:
            flags |= 4

        fl = num(r.get("number_of_floors"), 0.0)
        floors = int(fl) if 0 < fl < 255 else 255
        yr = int(num(r.get("year_built"), 0.0))
        if not 1600 < yr < 2100:
            yr = 0
        else:
            stats["with_year"] += 1

        struct.pack_into(
            "<fffBBBBHBB", buf, i * REC,
            num(r.get("x_m")), num(r.get("y_m")), num(r.get("roof_height")),
            a_ix.get(r.get("facade_archetype") or "", 0),
            d_ix.get(r.get("district") or "", 0),
            t_ix.get(r.get("lod_tier") or "block", 0),
            flags, yr, floors,
            c_ix.get(r.get("match_confidence") or "none", 0),
        )
        stats["records"] += 1

    with open(os.path.join(OUT, "core.bin"), "wb") as f:
        f.write(buf)
    with open(os.path.join(OUT, "text.json"), "w", encoding="utf-8") as f:
        json.dump(text, f, separators=(",", ":"), ensure_ascii=False)

    # ---- tiles ------------------------------------------------------------
    # Phase 1 exported 1400 m tiles keyed by the object-name suffix. The
    # runtime streams those; the 200 m cell grid from 44_build_cells.py is the
    # LOD authoring unit and is carried alongside so the two can be reconciled
    # when the per-LOD export lands.
    # manhattan_base.glb holds every object whose name carried no tile suffix:
    # the landmass, the water plane and the bridge decks. It has no grid
    # position, so it is marked always-resident. Leaving it out of the tile
    # list is what made the first runtime render the ground as sky.
    tiles = []
    if os.path.isdir(EXPORTS):
        # `v` is the file's mtime. The runtime appends it to the URL so a
        # re-export invalidates the browser cache; without it the browser
        # happily serves a stale glb and a fixed export appears not to work.
        base = os.path.join(EXPORTS, "manhattan_base.glb")
        if os.path.exists(base):
            tiles.append({
                "file": "manhattan_base.glb",
                "tx": 0, "ty": 0, "always": True,
                "bytes": os.path.getsize(base),
                "v": int(os.path.getmtime(base)),
            })
        for fn in sorted(os.listdir(EXPORTS)):
            m = TILE_RE.match(fn)
            if not m:
                continue
            tx, ty = int(m.group(1)), int(m.group(2))
            p = os.path.join(EXPORTS, fn)
            tiles.append({
                "file": fn,
                "tx": tx, "ty": ty, "always": False,
                "bytes": os.path.getsize(p),
                "v": int(os.path.getmtime(p)),
            })

    # Phase 2E street layer: sidewalks, kerbs and paint. Its own tile set with
    # its own radius, because a kerb is invisible past a few hundred metres
    # while the massing has to be visible across the island.
    street_tiles = []
    if os.path.isdir(EXPORTS):
        for fn in sorted(os.listdir(EXPORTS)):
            m = STREET_RE.match(fn)
            if not m:
                continue
            p = os.path.join(EXPORTS, fn)
            street_tiles.append({
                "file": fn,
                "tx": int(m.group(1)), "ty": int(m.group(2)),
                "always": False,
                "bytes": os.path.getsize(p),
                "v": int(os.path.getmtime(p)),
            })

    tile_m = 1400.0
    idx_path = os.path.join(EXPORTS, "building_index.json")
    if os.path.exists(idx_path):
        bi = json.load(open(idx_path, encoding="utf-8"))
        tile_m = float(bi.get("tile_size_m") or tile_m)

    cell_manifest = None
    cm_path = os.path.join(CELLS, "cell_manifest.json")
    if os.path.exists(cm_path):
        cm = json.load(open(cm_path, encoding="utf-8"))
        cell_manifest = {"grid": cm["grid"], "lods": cm["lods"],
                         "counts": cm["counts"]}

    # LAND_LEVEL: Phase 1 raised the land plane to 12 m to cure depth-buffer
    # speckle at 15 km, but buildings still extrude from 0. The bottom 12 m of
    # every building is therefore buried, which silently hid every ground-floor
    # treatment the classifier assigns. The runtime needs the number to know
    # where the street actually is, so read it from the source of truth rather
    # than duplicating the constant.
    land_level = 12.0
    bc_path = os.path.join(ROOT, "scripts", "blender_common.py")
    if os.path.exists(bc_path):
        m = re.search(r"^LAND_LEVEL\s*=\s*([0-9.]+)",
                      open(bc_path, encoding="utf-8").read(), re.M)
        if m:
            land_level = float(m.group(1))

    xs = [num(r.get("x_m")) for r in rows]
    ys = [num(r.get("y_m")) for r in rows]
    hs = [num(r.get("roof_height")) for r in rows]

    city = {
        "schema_version": 1,
        "generated_by": "scripts/phase2/45_build_runtime_data.py",
        "projection": {
            "type": "local_tangent_plane",
            "lat0": 40.78, "lon0": -73.968,
            "units": "metres",
            "note": "x east, y north; glTF is exported Y-up so world y = -y_m",
        },
        "land_level_m": land_level,
        "sea_level_m": 0.0,
        "buildings": len(rows),
        "record_bytes": REC,
        "bounds": {"x": [min(xs), max(xs)], "y": [min(ys), max(ys)],
                   "h_max": max(hs)},
        "archetypes": archetypes,
        "districts": districts,
        "tiers": TIERS,
        "confidence": CONF,
        "materials": materials,
        "roofs": roofs,
        "grounds": grounds,
        # archetype index -> [material index, roof index, ground index]
        "traits": [[materials.index(traits[a][0]),
                    roofs.index(traits[a][1]),
                    grounds.index(traits[a][2])] if a in traits else [0, 0, 0]
                   for a in archetypes],
        "tiles": {"size_m": tile_m, "prefix": "manhattan_",
                  "count": len(tiles), "list": tiles},
        "street_tiles": {"size_m": tile_m, "prefix": "streets_",
                         "far_m": 2200.0,
                         "count": len(street_tiles), "list": street_tiles},
        "cells": cell_manifest,
        "attribution": [
            "Map data (c) OpenStreetMap contributors, ODbL 1.0",
            "Building and neighbourhood data from NYC Open Data",
            "Not endorsed by the City of New York",
        ],
    }
    with open(os.path.join(OUT, "city.json"), "w", encoding="utf-8") as f:
        json.dump(city, f, separators=(",", ":"))

    sizes = {n: os.path.getsize(os.path.join(OUT, n))
             for n in ("city.json", "core.bin", "text.json")}
    report = {
        "buildings": len(rows),
        "archetypes": len(archetypes),
        "districts": len(districts),
        "tiles": len(tiles),
        "tile_bytes": sum(t["bytes"] for t in tiles),
        "street_tiles": len(street_tiles),
        "street_tile_bytes": sum(t["bytes"] for t in street_tiles),
        "payload_bytes": sizes,
        "payload_total_mb": round(sum(sizes.values()) / 1e6, 2),
        "with_text": len(text),
        "with_year": stats["with_year"],
        "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(DOCS, "RUNTIME_DATA_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("=" * 74)
    print("PHASE 2C  RUNTIME DATA PAYLOAD")
    print("=" * 74)
    print("  buildings            : %d" % len(rows))
    print("  archetypes/districts : %d / %d" % (len(archetypes),
                                                len(districts)))
    print("  with name or address : %d" % len(text))
    print("  with a known year    : %d" % stats["with_year"])
    print("-" * 74)
    for n, b in sizes.items():
        print("  %-20s %8.2f MB" % (n, b / 1e6))
    print("  %-20s %8.2f MB" % ("payload total", sum(sizes.values()) / 1e6))
    print("-" * 74)
    print("  glb tiles            : %d, %.1f MB"
          % (len(tiles), sum(t["bytes"] for t in tiles) / 1e6))
    print("  street tiles         : %d, %.1f MB"
          % (len(street_tiles), sum(t["bytes"] for t in street_tiles) / 1e6))
    print("  -> %s" % os.path.relpath(OUT, ROOT))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
