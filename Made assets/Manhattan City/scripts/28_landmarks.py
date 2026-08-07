"""
28_landmarks.py — hero-silhouette enhancements on top of the generic massing.

Runs inside Blender. Idempotent (purges 08_landmarks).

The generic building pass already produces accurate landmarks wherever OSM
carries a real height, and 02_process_osm.py repairs the towers whose named way
held a podium height. What is left are the features that are not "an extruded
footprint" at all:

  * One World Trade Center's mast (417 m roof -> 541.3 m tip), which is the
    single most identifying object in the Lower Manhattan silhouette
  * antenna masts on the Empire State and a few Midtown broadcast towers
  * the Statue of Liberty, including Fort Wood's star base - tiny, but it
    anchors the whole harbour read

Positions come from the building cache by name where possible, so nothing is
hand-placed in scene space.
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

GROUND = bc.LAND_LEVEL

# name -> (tip height above ground, base radius, style)
MASTS = {
    "One World Trade Center": (541.3, 3.2, "mast"),
    "Empire State Building":  (443.2, 3.0, "mast"),
    "4 Times Square":         (341.0, 2.2, "mast"),
    "Conde Nast Building":    (341.0, 2.2, "mast"),
}

# Liberty Island, from the real coordinates
LIBERTY_LAT, LIBERTY_LON = 40.68925, -74.04450


def taper(V, F, cx, cy, z0, z1, r0, r1, seg, rgba_unused=None, twist=0.0):
    b = len(V)
    for k in range(seg):
        a = 2 * math.pi * k / seg
        V.append((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z0))
    for k in range(seg):
        a = 2 * math.pi * k / seg + twist
        V.append((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z1))
    for k in range(seg):
        j = (k + 1) % seg
        F.append((b + k, b + j, b + seg + j, b + seg + k))
    F.append(tuple(b + seg + k for k in range(seg)))
    return b


def build_masts(blds):
    V, F = [], []
    done = []
    index = {}
    for x in blds:
        n = x.get("name")
        if n in MASTS and (n not in index or x["h"] > index[n]["h"]):
            index[n] = x

    for name, (tip, rad, _style) in MASTS.items():
        b = index.get(name)
        if not b:
            continue
        base = GROUND + b["h"]
        if tip <= base + 4.0:
            continue
        cx, cy = b["cx"], b["cy"]
        # tapered mast in two stages so it reads against the sky
        mid = base + (tip - base) * 0.45
        taper(V, F, cx, cy, base, mid, rad, rad * 0.55, 8)
        taper(V, F, cx, cy, mid, tip, rad * 0.55, rad * 0.16, 6)
        done.append({"name": name, "roof": round(b["h"], 1), "tip": tip})
    return V, F, done


def build_liberty():
    """Fort Wood star base, pedestal, figure, raised arm and torch."""
    V, F = [], []
    cx, cy = bc.ll2xy(LIBERTY_LAT, LIBERTY_LON)
    z = GROUND

    # Fort Wood: 11-point star, ~as wide as the real work
    star_r_out, star_r_in, pts = 46.0, 30.0, 11
    b = len(V)
    ring = []
    for k in range(pts * 2):
        a = math.pi * k / pts
        r = star_r_out if k % 2 == 0 else star_r_in
        ring.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    for (x, y) in ring:
        V.append((x, y, z))
    for (x, y) in ring:
        V.append((x, y, z + 12.0))
    n = len(ring)
    for k in range(n):
        j = (k + 1) % n
        F.append((b + k, b + j, b + n + j, b + n + k))
    F.append(tuple(b + n + k for k in range(n)))

    # pedestal: two tapering blocks up to 47 m
    taper(V, F, cx, cy, z + 12.0, z + 30.0, 20.0, 16.5, 4, twist=math.pi / 4)
    taper(V, F, cx, cy, z + 30.0, z + 47.0, 14.0, 11.5, 4, twist=math.pi / 4)

    # figure: robe 47 -> 80, shoulders, head, crown
    taper(V, F, cx, cy, z + 47.0, z + 74.0, 9.5, 5.4, 8)
    taper(V, F, cx, cy, z + 74.0, z + 82.0, 5.4, 3.4, 8)
    taper(V, F, cx, cy, z + 82.0, z + 86.5, 2.1, 2.4, 8)      # head
    taper(V, F, cx, cy, z + 86.5, z + 90.0, 4.6, 1.0, 11)     # crown spikes

    # raised right arm + torch, offset to one side
    ax, ay = cx + 6.5, cy + 3.0
    taper(V, F, ax, ay, z + 68.0, z + 88.0, 2.0, 1.5, 6)
    taper(V, F, ax, ay, z + 88.0, z + 92.5, 1.5, 1.2, 6)
    taper(V, F, ax, ay, z + 92.5, z + 95.5, 2.6, 1.6, 8)      # torch bowl
    taper(V, F, ax, ay, z + 95.5, z + 100.0, 1.4, 0.3, 6)     # flame
    return V, F, (cx, cy)


def mesh_from(name, V, F, mat, collection):
    if not F:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(V, [], F)
    me.validate(verbose=False)
    me.update()
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    try:
        me.shade_flat()
    except Exception:
        pass
    return ob


def main():
    t0 = time.time()
    bc.purge_collection("08_landmarks")

    blds = pickle.load(open(os.path.join(bc.CACHE, "buildings.pkl"), "rb"))
    steel = bpy.data.materials.get("MAT_steel")
    conc = bpy.data.materials.get("MAT_concrete")

    Vm, Fm, done = build_masts(blds)
    mesh_from("LMK_masts", Vm, Fm, steel, "08_landmarks")

    Vl, Fl, pos = build_liberty()
    mesh_from("LMK_statue_of_liberty", Vl, Fl, conc, "08_landmarks")

    return {"masts": done,
            "liberty_xy": (round(pos[0]), round(pos[1])),
            "liberty_verts": len(Vl),
            "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    result = main()
    print(result)
