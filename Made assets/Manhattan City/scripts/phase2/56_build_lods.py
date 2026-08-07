"""
56_build_lods.py -- Phase 2C: the far tiers of the LOD ladder, built in Blender.

    blender -b --factory-startup --python scripts/phase2/56_build_lods.py

44_build_cells.py defined a five-tier ladder in January and nothing ever
exported tiers 2 to 4. The runtime compensated by setting its streaming
radius to 30 km, which on a 21 km island means every one of the 119 tiles is
resident from anywhere: 180 MB of full-detail geometry in memory at all times,
no streaming, no LOD. This builds the missing tiers.

    L2   700 - 2000 m   footprint simplified to 10 vertices, extruded
    L3  2000 - 6000 m   one oriented box per building
    L4  6000 m +        the skyline only: everything at or above 100 m

The ladder in 44_build_cells.py puts L2 and L3 on the 800 m sector. They are
built on Phase 1's 1400 m tile grid instead, because that is the grid the
full-detail geometry actually exists on, and the two do not nest: an 800 m
sector straddles up to four 1400 m tiles, so a distance-based swap between
them would either draw a building twice -- coincident geometry, z-fighting --
or leave a hole. On the tile grid the swap is exact: each tile shows exactly
one of full, L2 or L3.

Only the buildings are replaced. A tile's roads, park trees and terrain carry
no _bid and stay resident at every range, which is why these files contain
building massing and nothing else.

Nothing here touches the frozen world. The massing is regenerated from the
same two frozen inputs Phase 1 used -- the cached OSM footprints and the
registry's surveyed heights -- so an L2 sector is the same building in the
same place as the L0 tile it replaces, just with the detail removed. The
vertical datum is the land plane (LAND_LEVEL + min_h .. LAND_LEVEL + h),
exactly as 20_buildings.py extrudes the full detail: the L0->L2/L3/L4 swap
must not move a single roof. Output goes to exports/lod/ and a separate
blend.
"""

import csv
import json
import math
import os
import pickle
import sys
import time
from collections import defaultdict

import bpy

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
from mesh_audit import assert_outward  # noqa: E402

ROOT = os.path.dirname(SCRIPTS)
REG = os.path.join(ROOT, "data", "manhattan", "buildings")
CELLS = os.path.join(ROOT, "data", "manhattan", "cells")
CACHE = os.path.join(ROOT, "source_data", "cache")
DOCS = os.path.join(ROOT, "docs", "phase2")
OUT = os.path.join(bc.EXPORTS, "lod")

L2_VERTS = 10           # ring vertices kept at L2
L4_MIN_H = 100.0        # the pin height from 44_build_cells.py
TILE = 1400.0           # Phase 1's export tile, the grid the swap runs on
LAND_LEVEL = bc.LAND_LEVEL  # 12.0; the datum the full-detail tiles extrude on

# Flat colour per material family. glTF cannot carry the Phase 2D facade
# graph, and at 700 m it does not need to: what has to survive is that
# Harlem reads as brick and Sixth Avenue reads as glass.
FAMILY_RGB = {
    "brick_red":          (0.128, 0.055, 0.040),
    "brick_dark":         (0.070, 0.036, 0.030),
    "brick_institutional": (0.115, 0.062, 0.048),
    "buff_brick":         (0.215, 0.170, 0.115),
    "white_brick":        (0.330, 0.320, 0.295),
    "brownstone":         (0.105, 0.062, 0.040),
    "limestone":          (0.300, 0.283, 0.245),
    "stone_gothic":       (0.215, 0.205, 0.180),
    "cast_iron":          (0.120, 0.122, 0.118),
    "concrete_grid":      (0.205, 0.200, 0.190),
    "concrete_open":      (0.230, 0.225, 0.212),
    "curtain_glass":      (0.055, 0.082, 0.105),
    "glass_stone":        (0.105, 0.120, 0.135),
    "mixed_panel":        (0.150, 0.148, 0.145),
    "scaffold":           (0.140, 0.120, 0.075),
    "steel_shed":         (0.130, 0.132, 0.130),
}
DEFAULT_RGB = (0.150, 0.120, 0.100)


# ---------------------------------------------------------------------------
# footprint reduction
# ---------------------------------------------------------------------------
def ring_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def simplify_ring(pts, keep):
    """Drop the vertices that cost the least area, until `keep` remain.

    Douglas-Peucker is wrong for a closed footprint: it is anchored on two
    endpoints that mean nothing on a ring, and it will happily flatten a
    corner of a building while preserving a doorway reveal. Removing the
    vertex whose ear has the smallest area keeps the silhouette instead."""
    ring = list(pts)
    if len(ring) <= keep:
        return ring
    while len(ring) > keep:
        n = len(ring)
        worst = None
        worst_i = 0
        for i in range(n):
            ax, ay = ring[(i - 1) % n]
            bx, by = ring[i]
            cx, cy = ring[(i + 1) % n]
            area = abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) * 0.5
            if worst is None or area < worst:
                worst = area
                worst_i = i
        ring.pop(worst_i)
    return ring


def convex_hull(pts):
    p = sorted(set((round(x, 3), round(y, 3)) for x, y in pts))
    if len(p) < 3:
        return p

    def cross(o, a, b):
        return ((a[0] - o[0]) * (b[1] - o[1]) -
                (a[1] - o[1]) * (b[0] - o[0]))

    lower = []
    for q in p:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    upper = []
    for q in reversed(p):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return lower[:-1] + upper[:-1]


def min_area_rect(pts):
    """Smallest-area enclosing rectangle, by rotating calipers on the hull.

    An axis-aligned box would be wrong here: Manhattan's grid is rotated 29
    degrees, so an axis-aligned box around a row of brownstones is nearly
    twice the footprint and the far skyline would read as a fat blur."""
    hull = convex_hull(pts)
    if len(hull) < 3:
        xs = [p[0] for p in pts] or [0.0]
        ys = [p[1] for p in pts] or [0.0]
        return [(min(xs), min(ys)), (max(xs), min(ys)),
                (max(xs), max(ys)), (min(xs), max(ys))]
    best = None
    n = len(hull)
    for i in range(n):
        ax, ay = hull[i]
        bx, by = hull[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        d = math.hypot(ex, ey)
        if d < 1e-9:
            continue
        ex, ey = ex / d, ey / d
        u0 = v0 = 1e18
        u1 = v1 = -1e18
        for px, py in hull:
            u = (px - ax) * ex + (py - ay) * ey
            v = -(px - ax) * ey + (py - ay) * ex
            u0, u1 = min(u0, u), max(u1, u)
            v0, v1 = min(v0, v), max(v1, v)
        area = (u1 - u0) * (v1 - v0)
        if best is None or area < best[0]:
            best = (area, ax, ay, ex, ey, u0, u1, v0, v1)
    _, ax, ay, ex, ey, u0, u1, v0, v1 = best

    def pt(u, v):
        return (ax + ex * u - ey * v, ay + ey * u + ex * v)

    return [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)]


# ---------------------------------------------------------------------------
# mesh assembly
# ---------------------------------------------------------------------------
class Massing:
    """Accumulates extruded prisms into one mesh with per-corner colour."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []

    def prism(self, ring, z0, z1, rgb):
        n = len(ring)
        if n < 3 or z1 <= z0:
            return
        # counter-clockwise, so the side quads face outward
        if ring_area(ring) < 0:
            ring = ring[::-1]
        base = len(self.verts)
        for x, y in ring:
            self.verts.append((x, y, z0))
        for x, y in ring:
            self.verts.append((x, y, z1))
        rgba = (rgb[0], rgb[1], rgb[2], 1.0)
        for i in range(n):
            j = (i + 1) % n
            self.faces.append((base + i, base + j, base + n + j, base + n + i))
            self.cols.extend([rgba] * 4)
        self.faces.append(tuple(base + n + i for i in range(n)))
        self.cols.extend([rgba] * n)
        # no floor: nothing at 700 m ever sees the underside of a building

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def to_object(self, name, collection):
        assert_outward(name, self.verts, self.faces)
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        attr = me.color_attributes.new(name="vcol", type='FLOAT_COLOR',
                                       domain='CORNER')
        flat = []
        for c in self.cols:
            flat.extend(c)
        attr.data.foreach_set("color", flat)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


def export_glb(objs, path, draco=True):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kwargs = dict(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_texcoords=False,
        export_normals=True, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_animations=False,
        export_attributes=True,
        export_vertex_color='NAME', export_vertex_color_name='vcol',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_draco_mesh_compression_enable=bool(draco),
        # The two defaults that buried the road surface and corrupted 83% of
        # the building ids in P2-022 and P2-023. A 20-bit position over a
        # sector's 800 m is under a millimetre.
        export_draco_position_quantization=20,
        export_draco_generic_quantization=24,
    )
    op = bpy.ops.export_scene.gltf
    valid = set(op.get_rna_type().properties.keys())
    op(**{k: v for k, v in kwargs.items() if k in valid})
    return os.path.getsize(path) if os.path.exists(path) else 0


def main():
    t0 = time.time()
    print("=" * 74)
    print("PHASE 2C  LOD FAR TIERS (L2 sector, L3 sector, L4 skyline)")
    print("=" * 74)

    with open(os.path.join(CACHE, "buildings.pkl"), "rb") as f:
        cache = pickle.load(f)
    rows = list(csv.DictReader(
        open(os.path.join(REG, "building_registry.csv"), encoding="utf-8")))
    print("  footprints      : %d cached, %d registry rows"
          % (len(cache), len(rows)))
    if len(cache) != len(rows):
        print("  !! cache and registry disagree; aborting")
        return 1

    bpy.ops.wm.read_homefile(use_empty=True)
    col = bpy.data.collections.new("40_lod")
    bpy.context.scene.collection.children.link(col)
    mat = bpy.data.materials.new("MAT_lod_massing")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.75
    nt.links.new(bsdf.outputs["BSDF"], out_n.inputs["Surface"])

    # Group on the grid the full-detail tiles were exported to, so a tile can
    # be swapped for its own massing with nothing drawn twice and nothing
    # missing. Verified against exports/: every derived key has a file.
    by_tile = defaultdict(list)
    for r in rows:
        k = "%+03d_%+03d" % (math.floor(float(r["x_m"]) / TILE),
                             math.floor(float(r["y_m"]) / TILE))
        by_tile[k].append(r)

    os.makedirs(OUT, exist_ok=True)
    manifest = {"grid_m": TILE, "prefix": "", "L2": {}, "L3": {}, "L4": {}}
    stat = {"L2": [0, 0, 0], "L3": [0, 0, 0], "L4": [0, 0, 0]}
    n_sky = 0
    dropped = {"pts_lt3": 0, "h_le_minh": 0}
    drawn = 0

    for si, (sid, members) in enumerate(sorted(by_tile.items())):
        m2 = Massing()
        m3 = Massing()
        m4 = Massing()
        x0 = y0 = 1e18
        x1 = y1 = -1e18
        for r in members:
            b = cache[int(r["building_id"])]
            pts = b["pts"]
            if len(pts) < 3:
                dropped["pts_lt3"] += 1
                continue
            h = float(b["h"] or 0.0)
            min_h = float(b.get("min_h") or 0.0)
            if h <= min_h:
                dropped["h_le_minh"] += 1
                continue
            # The full-detail tiles extrude on the land plane
            # (20_buildings.py: z0 = GROUND + min_h, top = GROUND + h). The
            # massing must sit on the same datum or the L0->L2/L3/L4 swap
            # drops every roof by LAND_LEVEL (a uniform 12 m silhouette
            # error, found by the 2O-B re-measurement of bid 20009).
            z0 = LAND_LEVEL + min_h
            z1 = LAND_LEVEL + h
            rgb = FAMILY_RGB.get(r.get("material_family"), DEFAULT_RGB)
            m2.prism(simplify_ring(pts, L2_VERTS), z0, z1, rgb)
            m3.prism(min_area_rect(pts), z0, z1, rgb)
            if h >= L4_MIN_H:
                m4.prism(min_area_rect(pts), z0, z1, rgb)
                n_sky += 1
            drawn += 1
            for px, py in pts:
                x0 = min(x0, px); x1 = max(x1, px)
                y0 = min(y0, py); y1 = max(y1, py)

        if not m2.faces:
            continue
        cx = (x0 + x1) * 0.5
        cy = (y0 + y1) * 0.5
        radius = max(math.hypot(x1 - cx, y1 - cy), 1.0)

        # L4 is per tile, not one merged city mesh. A single always-resident
        # skyline would sit inside the L2 and L3 massing of the same towers
        # wherever the camera is close, and coincident geometry z-fights.
        for tag, mm in (("L2", m2), ("L3", m3), ("L4", m4)):
            if not mm.faces:
                continue
            name = "LOD_%s_%s" % (tag, sid)
            ob = mm.to_object(name, col)
            ob.data.materials.append(mat)
            path = os.path.join(OUT, "%s_%s.glb" % (sid, tag))
            size = export_glb([ob], path)
            manifest[tag][sid] = {
                "file": "%s_%s.glb" % (sid, tag),
                "c": [round(cx, 1), round(cy, 1)], "r": round(radius, 1),
                "tris": mm.tris, "bytes": size, "n": len(members),
            }
            stat[tag][0] += mm.tris
            stat[tag][1] += size
            stat[tag][2] += 1
            # one object per sector per tier would be 556 objects in the
            # blend; keep the geometry but drop it from the export selection
            for o in bpy.data.objects:
                o.select_set(False)

        if (si + 1) % 50 == 0:
            print("    %d/%d sectors  (%.0fs)"
                  % (si + 1, len(by_tile), time.time() - t0))

    manifest["l4_min_h"] = L4_MIN_H
    manifest["land_level_m"] = LAND_LEVEL
    manifest["base"] = "LAND_LEVEL + min_h"

    ladder = json.load(open(os.path.join(CELLS, "cell_manifest.json"),
                            encoding="utf-8"))["lods"]
    manifest["ladder"] = ladder
    manifest["generated_by"] = "scripts/phase2/56_build_lods.py"
    with open(os.path.join(OUT, "lod_manifest.json"), "w",
              encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"))

    blend = os.path.join(bc.BLEND, "manhattan_lod.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    # Regression guard: every registry building must be accounted for. A new
    # skip rule that silently dropped buildings would break the tally and the
    # LOD tile would stop being "the same building in the same place".
    if drawn + dropped["pts_lt3"] + dropped["h_le_minh"] != len(rows):
        print("  !! drawn (%d) + dropped (%s) != registry rows (%d); aborting"
              % (drawn, dropped, len(rows)))
        return 1
    if dropped["pts_lt3"] or dropped["h_le_minh"]:
        print("  note: dropped by degenerate guards: %s" % dropped)

    report = {
        "tiles": len(manifest["L2"]),
        "grid_m": TILE,
        "land_level_m": LAND_LEVEL,
        "drawn": drawn,
        "dropped": dropped,
        "L2": {"tris": stat["L2"][0], "mb": round(stat["L2"][1] / 1048576, 2)},
        "L3": {"tris": stat["L3"][0], "mb": round(stat["L3"][1] / 1048576, 2)},
        "L4": {"tris": stat["L4"][0], "buildings": n_sky,
               "tiles": stat["L4"][2],
               "mb": round(stat["L4"][1] / 1048576, 2)},
        "l2_ring_verts": L2_VERTS,
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "LOD_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  L2  %8d tris over %d tiles  %.1f MB"
          % (stat["L2"][0], stat["L2"][2], stat["L2"][1] / 1048576))
    print("  L3  %8d tris over %d tiles  %.1f MB"
          % (stat["L3"][0], stat["L3"][2], stat["L3"][1] / 1048576))
    print("  L4  %8d tris over %d tiles, %d buildings above %.0f m, %.1f MB"
          % (stat["L4"][0], stat["L4"][2], n_sky, L4_MIN_H,
             stat["L4"][1] / 1048576))
    print("  saved %s  (%.0fs)"
          % (os.path.relpath(blend, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
