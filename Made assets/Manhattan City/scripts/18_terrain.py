"""
18_terrain.py — water, Manhattan landmass, context shorelines, park ground.

Runs inside Blender. Idempotent (purges 01_water / 02_landmass / 04_parks first).

Method
------
* Water is a single very large plane at z=0 - the whole world starts as water.
* Manhattan is the one closed coastline ring that contains the projection
  origin. It gets filled with bmesh.triangle_fill and extruded into a slab.
* Other closed rings (Governors / Roosevelt / Randalls / Liberty / Ellis)
  are filled the same way - these read strongly in the harbour shots.
* Brooklyn / Queens / New Jersey / Bronx shorelines arrive as *open* chains
  because the download bbox cuts them. Rather than trying to close them, we
  exploit the OSM rule that land lies to the LEFT of a coastline way and
  extrude an inland "skirt" ribbon from each chain. From the air that gives a
  correct shoreline with land behind it, which is all the wide shots need.
* Central Park's lake and reservoir are re-cut into the land as water at
  land level, matching the very recognisable shapes in the reference.
"""

import importlib
import math
import os
import pickle
import sys
import time

import bmesh
import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

WATER_EXTENT = 60000.0     # half-size of the ocean plane (metres)
LAND_TOP = bc.LAND_LEVEL   # +2 m
LAND_BOTTOM = -14.0
SKIRT_INLAND = 4200.0      # how far context land extends back from the shore
PARK_WATER_Z = LAND_TOP + 0.06


def _mats():
    return {m: bpy.data.materials.get(m) for m in
            ("MAT_water", "MAT_land", "MAT_park", "MAT_concrete")}


def fill_ring(name, ring, z_top, z_bottom, material, collection):
    """Triangulate a closed 2D ring and extrude it down into a solid slab."""
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z_top)) for (x, y) in ring]
    bm.verts.ensure_lookup_table()
    edges = []
    n = len(verts)
    for i in range(n):
        try:
            edges.append(bm.edges.new((verts[i], verts[(i + 1) % n])))
        except ValueError:
            pass  # duplicate edge - ring folded back on itself, skip

    try:
        bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False,
                                edges=edges)
    except Exception as e:
        print("   triangle_fill failed on %s: %s" % (name, e))
        bm.free()
        return None

    faces = [f for f in bm.faces]
    if not faces:
        bm.free()
        return None

    # give it thickness so the shoreline reads from low angles
    if z_bottom < z_top:
        r = bmesh.ops.extrude_face_region(bm, geom=faces)
        moved = [g for g in r["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, z_bottom - z_top))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if material:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    return ob


def build_water(mat):
    me = bpy.data.meshes.new("MSH_ocean")
    e = WATER_EXTENT
    me.from_pydata([(-e, -e, 0), (e, -e, 0), (e, e, 0), (-e, e, 0)],
                   [], [(0, 1, 2, 3)])
    me.update()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new("WATER_ocean", me)
    bc.link_to(ob, "01_water")
    return ob


def build_skirt(name, chain, inland, z_top, z_bottom, mat, collection):
    """
    Ribbon extending inland (OSM: land is on the LEFT of a coastline way).
    Produces a quad strip plus a downward extrusion for thickness.
    """
    if len(chain) < 2:
        return None
    verts, faces = [], []
    n = len(chain)
    for i, (x, y) in enumerate(chain):
        # smoothed left-hand normal
        if i == 0:
            dx, dy = chain[1][0] - x, chain[1][1] - y
        elif i == n - 1:
            dx, dy = x - chain[-2][0], y - chain[-2][1]
        else:
            dx = chain[i + 1][0] - chain[i - 1][0]
            dy = chain[i + 1][1] - chain[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L          # left normal
        verts.append((x, y, z_top))
        verts.append((x + nx * inland, y + ny * inland, z_top))

    for i in range(n - 1):
        a, b = 2 * i, 2 * i + 1
        c, d = 2 * (i + 1), 2 * (i + 1) + 1
        faces.append((a, c, d, b))

    base = len(verts)
    verts.extend([(v[0], v[1], z_bottom) for v in verts])
    # side wall along the shoreline edge only (the inland edge is never seen)
    for i in range(n - 1):
        a, c = 2 * i, 2 * (i + 1)
        faces.append((a, base + a, base + c, c))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False)
    me.update()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    return ob


def join_objects(objs, name):
    """Join a list of objects into one, without relying on operator context."""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        objs[0].data.name = name
        return objs[0]

    bm = bmesh.new()
    mats = []
    for o in objs:
        for m in o.data.materials:
            if m and m.name not in [x.name for x in mats]:
                mats.append(m)
    for o in objs:
        tmp = o.data.copy()
        # remap this object's material slots onto the merged slot list
        remap = {}
        for i, m in enumerate(o.data.materials):
            remap[i] = [x.name for x in mats].index(m.name) if m else 0
        for p in tmp.polygons:
            p.material_index = remap.get(p.material_index, 0)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    merged = bpy.data.objects.new(name, me)
    col = objs[0].users_collection[0].name
    bc.link_to(merged, col)
    for o in objs:
        d = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if d.users == 0:
            bpy.data.meshes.remove(d)
    return merged


def main():
    t0 = time.time()
    mats = _mats()
    for c in ("01_water", "02_landmass"):
        bc.purge_collection(c)

    land = pickle.load(open(os.path.join(bc.CACHE, "land.pkl"), "rb"))
    report = {}

    build_water(mats["MAT_water"])

    # --- Manhattan island ------------------------------------------------
    island = land.get("island")
    if island:
        ob = fill_ring("LAND_manhattan", island, LAND_TOP, LAND_BOTTOM,
                       mats["MAT_land"], "02_landmass")
        report["manhattan_verts"] = len(ob.data.vertices) if ob else 0
        report["manhattan_ring_pts"] = len(island)

    # --- other closed islands (Governors, Roosevelt, Randalls, Liberty...) -
    small = []
    for i, r in enumerate(land.get("islands", [])[:120]):
        a = abs(bc.polygon_area(r))
        if a < 8000.0:
            continue
        ob = fill_ring("LAND_isle_%03d" % i, r, LAND_TOP, LAND_BOTTOM,
                       mats["MAT_land"], "02_landmass")
        if ob:
            small.append(ob)
    if small:
        join_objects(small, "LAND_harbour_islands")
    report["harbour_islands"] = len(small)

    # --- context land (Brooklyn / Queens / NJ / Bronx) --------------------
    # Built from the winding-number raster: one quad per horizontal land span.
    # Sits marginally below LAND_TOP so the exact Manhattan polygon reads on
    # top of it without z-fighting.
    ras = land.get("raster")
    if ras and ras.get("contours"):
        z = LAND_TOP - 0.5

        # Smoothed shoreline contours, triangulated.
        #
        # Earlier versions emitted one quad per 50 m raster cell. Welding the
        # lattice fixed the seams and the z-fighting, but the staircase
        # remained - because at that point the steps were the data, not the
        # mesh. Tracing the land boundary into loops and smoothing those loops
        # removes the staircase and costs far fewer faces than one quad per
        # cell.
        bm = bmesh.new()
        n_ok = 0
        for pts in ras["contours"]:
            if len(pts) < 3:
                continue
            vs = [bm.verts.new((x, y, z)) for (x, y) in pts]
            edges = []
            for k in range(len(vs)):
                try:
                    edges.append(bm.edges.new((vs[k], vs[(k + 1) % len(vs)])))
                except ValueError:
                    pass
            if not edges:
                continue
            try:
                bmesh.ops.triangle_fill(bm, use_beauty=False,
                                        use_dissolve=False, edges=edges)
                n_ok += 1
            except Exception:
                pass

        me = bpy.data.meshes.new("LAND_context")
        bm.to_mesh(me)
        bm.free()
        if mats["MAT_land"]:
            me.materials.append(mats["MAT_land"])
        ob = bpy.data.objects.new("LAND_context", me)
        bc.link_to(ob, "02_landmass")
        report["context_contours"] = len(ras["contours"])
        report["context_filled"] = n_ok
        report["context_verts"] = len(me.vertices)
        report["context_km2"] = round(ras["land_km2"], 1)

        # a solid skirt under the raster hides the gap down to the sea floor
        e = ras["bounds"]
        me2 = bpy.data.meshes.new("LAND_context_base")
        me2.from_pydata([(e[0], e[1], LAND_BOTTOM), (e[2], e[1], LAND_BOTTOM),
                         (e[2], e[3], LAND_BOTTOM), (e[0], e[3], LAND_BOTTOM)],
                        [], [(0, 1, 2, 3)])
        me2.update()
        if mats["MAT_land"]:
            me2.materials.append(mats["MAT_land"])
        ob2 = bpy.data.objects.new("LAND_context_base", me2)
        ob2.hide_render = True
        ob2.hide_viewport = True
        bc.link_to(ob2, "02_landmass")

    print("terrain built in %.1fs: %s" % (time.time() - t0, report))
    return report


if __name__ == "__main__":
    result = main()
    print(result)
