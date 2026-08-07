"""
26_piers.py — Hudson and East River finger piers, wharfs and docks.

Runs inside Blender. Idempotent (purges 10_piers).

The west-side finger piers are one of the strongest silhouette cues in the
reference's harbour passes, so closed pier outlines get filled as real decks
and open pier ways get a default-width ribbon.
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

PIER_Z = bc.LAND_LEVEL + 0.9
PIER_THICK = 2.4
DEFAULT_W = 16.0


def main():
    t0 = time.time()
    bc.purge_collection("10_piers")

    piers = pickle.load(open(os.path.join(bc.CACHE, "piers.pkl"), "rb"))
    mat = bpy.data.materials.get("MAT_concrete")

    bm = bmesh.new()
    n_closed = n_ribbon = 0

    for p in piers:
        pts = p["pts"]
        if len(pts) < 2:
            continue

        closed = (len(pts) >= 4 and
                  math.dist(pts[0], pts[-1]) < max(6.0, DEFAULT_W))
        if closed:
            ring = pts[:-1] if math.dist(pts[0], pts[-1]) < 1e-6 else pts
            if len(ring) < 3:
                continue
            vs = [bm.verts.new((x, y, PIER_Z)) for (x, y) in ring]
            edges = []
            for k in range(len(vs)):
                try:
                    edges.append(bm.edges.new((vs[k], vs[(k + 1) % len(vs)])))
                except ValueError:
                    pass
            if not edges:
                continue
            try:
                res = bmesh.ops.triangle_fill(bm, use_beauty=False,
                                              use_dissolve=False, edges=edges)
                faces = [g for g in res["geom"]
                         if isinstance(g, bmesh.types.BMFace)]
                if faces:
                    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
                    mv = [g for g in ext["geom"]
                          if isinstance(g, bmesh.types.BMVert)]
                    bmesh.ops.translate(bm, verts=mv, vec=(0, 0, -PIER_THICK))
                n_closed += 1
            except Exception:
                pass
        else:
            # open way -> extrude a default-width deck along it
            n = len(pts)
            half = DEFAULT_W * 0.5
            ring = []
            for i, (x, y) in enumerate(pts):
                if i == 0:
                    dx, dy = pts[1][0] - x, pts[1][1] - y
                elif i == n - 1:
                    dx, dy = x - pts[-2][0], y - pts[-2][1]
                else:
                    dx = pts[i + 1][0] - pts[i - 1][0]
                    dy = pts[i + 1][1] - pts[i - 1][1]
                L = math.hypot(dx, dy) or 1.0
                ring.append((x - dy / L * half, y + dx / L * half))
            for i in range(n - 1, -1, -1):
                x, y = pts[i]
                if i == 0:
                    dx, dy = pts[1][0] - x, pts[1][1] - y
                elif i == n - 1:
                    dx, dy = x - pts[-2][0], y - pts[-2][1]
                else:
                    dx = pts[i + 1][0] - pts[i - 1][0]
                    dy = pts[i + 1][1] - pts[i - 1][1]
                L = math.hypot(dx, dy) or 1.0
                ring.append((x + dy / L * half, y - dx / L * half))
            if len(ring) < 3:
                continue
            vs = [bm.verts.new((x, y, PIER_Z)) for (x, y) in ring]
            edges = []
            for k in range(len(vs)):
                try:
                    edges.append(bm.edges.new((vs[k], vs[(k + 1) % len(vs)])))
                except ValueError:
                    pass
            if edges:
                try:
                    bmesh.ops.triangle_fill(bm, use_beauty=False,
                                            use_dissolve=False, edges=edges)
                    n_ribbon += 1
                except Exception:
                    pass

    me = bpy.data.meshes.new("PIER_decks")
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new("PIER_decks", me)
    bc.link_to(ob, "10_piers")

    return {"features": len(piers), "closed_decks": n_closed,
            "ribbon_decks": n_ribbon, "verts": len(me.vertices),
            "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    result = main()
    print(result)
