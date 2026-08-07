"""
19_parks.py — park ground, Central Park water bodies, and tree massing.

Runs inside Blender. Idempotent (purges 04_parks).

Central Park is the single most recognisable non-building feature of Manhattan,
and in the reference it reads because of three things together: the green
rectangle, the dark water of the Reservoir and the Lake, and the broken-up
canopy texture. All three are built here from real OSM polygons.

Trees are emitted as merged low-poly blobs rather than instanced objects: at
~25k trees, 45k objects would stall the depsgraph, while 25k blobs merged into
a handful of meshes costs about 400k verts and draws instantly.
"""

import importlib
import math
import os
import pickle
import random
import sys
import time

import bmesh
import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

PARK_Z = bc.LAND_LEVEL + 0.08
WATER_Z = bc.LAND_LEVEL + 0.02
TREE_AREA = 460.0          # one tree per this many m2 of park
MAX_TREES = 42000


def fill_polys(name, polys, z, material, collection, jitter_z=0.0):
    """Triangulate many 2D rings into a single merged mesh."""
    bm = bmesh.new()
    n_ok = 0
    for i, pts in enumerate(polys):
        if len(pts) < 3:
            continue
        zz = z + (jitter_z * (i % 7) / 7.0)
        vs = [bm.verts.new((x, y, zz)) for (x, y) in pts]
        edges = []
        for k in range(len(vs)):
            try:
                edges.append(bm.edges.new((vs[k], vs[(k + 1) % len(vs)])))
            except ValueError:
                pass
        if not edges:
            continue
        try:
            bmesh.ops.triangle_fill(bm, use_beauty=False, use_dissolve=False,
                                    edges=edges)
            n_ok += 1
        except Exception:
            pass
    if not bm.faces:
        bm.free()
        return None, 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if material:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    return ob, n_ok


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


def scatter_trees(polys, rng):
    """Poisson-ish scatter: jittered grid sampling, rejected outside the ring."""
    pts = []
    budget = MAX_TREES
    for p in polys:
        if budget <= 0:
            break
        xs = [q[0] for q in p]
        ys = [q[1] for q in p]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        w, h = x1 - x0, y1 - y0
        if w < 8 or h < 8:
            continue
        step = math.sqrt(TREE_AREA)
        nx = max(1, int(w / step))
        ny = max(1, int(h / step))
        if nx * ny > 60000:
            continue
        for iy in range(ny):
            for ix in range(nx):
                if budget <= 0:
                    break
                px = x0 + (ix + 0.5 + (rng.random() - 0.5) * 0.85) * (w / nx)
                py = y0 + (iy + 0.5 + (rng.random() - 0.5) * 0.85) * (h / ny)
                if point_in(px, py, p):
                    pts.append((px, py, rng.random()))
                    budget -= 1
    return pts


def build_trees(name, pts, material, collection):
    """Low-poly canopy blob: a 6-gon skirt plus an apex. 8 verts per tree."""
    V, F = [], []
    for (x, y, r) in pts:
        rad = 3.0 + 3.4 * r
        hgt = 5.5 + 7.5 * r
        base = len(V)
        for k in range(6):
            a = 2 * math.pi * k / 6 + r * 3.0
            V.append((x + rad * math.cos(a), y + rad * math.sin(a),
                      PARK_Z + hgt * 0.32))
        V.append((x, y, PARK_Z + hgt))          # apex
        V.append((x, y, PARK_Z))                # base point
        apex, bot = base + 6, base + 7
        for k in range(6):
            j = (k + 1) % 6
            F.append((base + k, base + j, apex))
            F.append((base + j, base + k, bot))
    if not F:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(V, [], F)
    me.validate(verbose=False)
    me.update()
    if material:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    return ob


def main():
    t0 = time.time()
    bc.purge_collection("04_parks")
    rng = random.Random(20260802)

    parks = pickle.load(open(os.path.join(bc.CACHE, "parks.pkl"), "rb"))
    water = pickle.load(open(os.path.join(bc.CACHE, "water.pkl"), "rb"))

    mat_park = bpy.data.materials.get("MAT_park")
    mat_tree = bpy.data.materials.get("MAT_tree")
    mat_water = bpy.data.materials.get("MAT_water")

    # --- park ground ------------------------------------------------------
    rings = [p["pts"] for p in parks if p["area"] > 400.0]
    ob, n = fill_polys("PARK_ground", rings, PARK_Z, mat_park, "04_parks",
                       jitter_z=0.05)
    report = {"park_polys": len(rings), "park_filled": n,
              "park_verts": len(ob.data.vertices) if ob else 0}

    # --- inland water (Central Park Reservoir + Lake, Harlem Meer, ...) ---
    #
    # OSM tags chunks of the Hudson and East River as natural=water too. Those
    # polygons are up to ~0.8 km2, so a size filter alone lets them through,
    # and being drawn at land height they float 12 m above the ocean plane and
    # read as bright white blobs scattered over the map. The land raster is the
    # authority: a water body is inland only if its centroid is on land.
    land = pickle.load(open(os.path.join(bc.CACHE, "land.pkl"), "rb"))
    ras = land.get("raster") or {}
    cell = ras.get("cell", 50.0)
    rx0, ry0, rx1, ry1 = ras.get("bounds", (0, 0, 0, 0))
    rows = {}
    for (yc, a, b) in ras.get("spans", []):
        rows.setdefault(int(round((yc - ry0) / cell - 0.5)), []).append((a, b))

    def on_land(x, y):
        r = int((y - ry0) / cell)
        for (a, b) in rows.get(r, ()):
            if a <= x <= b:
                return True
        return False

    inland, rejected = [], 0
    for w in water:
        if not (400.0 < w["area"] < 1.2e6):
            rejected += 1
            continue
        pts = w["pts"]
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        if not on_land(cx, cy):
            rejected += 1
            continue
        inland.append(pts)

    mat_pond = bpy.data.materials.get("MAT_pond") or mat_water
    obw, nw = fill_polys("PARK_water", inland, WATER_Z, mat_pond, "04_parks")
    report["inland_water_polys"] = nw
    report["water_rejected_offland"] = rejected
    named = [w["name"] for w in water if w.get("name")][:6]
    report["named_water"] = named

    # --- tree massing -----------------------------------------------------
    big = [p["pts"] for p in parks
           if p["area"] > 2500.0 and p["kind"] in
           ("park", "garden", "forest", "grass", "nature_reserve",
            "recreation_ground", "cemetery", "village_green", "meadow")]
    pts = scatter_trees(big, rng)
    # thin out trees that fall inside a water body so the Reservoir stays clear
    if inland:
        keep = []
        for (x, y, r) in pts:
            wet = False
            for wp in inland:
                if len(wp) > 2 and point_in(x, y, wp):
                    wet = True
                    break
            if not wet:
                keep.append((x, y, r))
        pts = keep

    chunks = {}
    for p in pts:
        k = (int(p[0] // 2000), int(p[1] // 2000))
        chunks.setdefault(k, []).append(p)
    ntree = 0
    for (kx, ky), sub in chunks.items():
        o = build_trees("TREE_%+03d_%+03d" % (kx, ky), sub, mat_tree, "04_parks")
        if o:
            ntree += len(sub)
    report["trees"] = ntree
    report["tree_meshes"] = len(chunks)
    report["seconds"] = round(time.time() - t0, 1)
    return report


if __name__ == "__main__":
    result = main()
    print(result)
