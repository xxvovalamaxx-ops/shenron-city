"""
22_roads.py — the Manhattan street network as flat ribbons.

Runs inside Blender. Idempotent (purges 03_roads).

Every OSM highway becomes a quad strip of its class width, laid just above the
landmass. Tunnels are dropped; bridge segments are dropped here and rebuilt at
deck height by 24_bridges.py.

The ribbons double as the traffic system's source: 30_traffic.py reuses the
same polylines as vehicle paths, so cars are guaranteed to sit on the roads.
"""

import importlib
import math
import os
import pickle
import sys
import time

import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

ROAD_Z = bc.LAND_LEVEL + 0.05
TILE = 2600.0


def ribbon(V, F, pts, w, z):
    """Quad strip centred on a polyline, with mitred-ish shared vertices."""
    n = len(pts)
    if n < 2:
        return
    half = w * 0.5
    base = len(V)
    for i, (x, y) in enumerate(pts):
        if i == 0:
            dx, dy = pts[1][0] - x, pts[1][1] - y
        elif i == n - 1:
            dx, dy = x - pts[-2][0], y - pts[-2][1]
        else:
            dx = pts[i + 1][0] - pts[i - 1][0]
            dy = pts[i + 1][1] - pts[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L * half, dx / L * half
        V.append((x + nx, y + ny, z))
        V.append((x - nx, y - ny, z))
    for i in range(n - 1):
        a = base + 2 * i
        F.append((a, a + 2, a + 3, a + 1))


def main():
    t0 = time.time()
    bc.purge_collection("03_roads")

    roads = pickle.load(open(os.path.join(bc.CACHE, "roads.pkl"), "rb"))
    mat = bpy.data.materials.get("MAT_asphalt")

    chunks = {}
    used = 0
    for r in roads:
        if r["tunnel"] or r["bridge"]:
            continue
        pts = r["pts"]
        if len(pts) < 2:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        key = (int(cx // TILE), int(cy // TILE))
        VF = chunks.get(key)
        if VF is None:
            VF = chunks[key] = ([], [])
        ribbon(VF[0], VF[1], pts, r["w"], ROAD_Z)
        used += 1

    made = 0
    verts = 0
    for (kx, ky), (V, F) in chunks.items():
        if not F:
            continue
        me = bpy.data.meshes.new("ROAD_%+03d_%+03d" % (kx, ky))
        me.from_pydata(V, [], F)
        me.validate(verbose=False)
        me.update()
        if mat:
            me.materials.append(mat)
        ob = bpy.data.objects.new(me.name, me)
        bc.link_to(ob, "03_roads")
        made += 1
        verts += len(me.vertices)

    return {"segments_total": len(roads), "segments_built": used,
            "meshes": made, "verts": verts,
            "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    result = main()
    print(result)
