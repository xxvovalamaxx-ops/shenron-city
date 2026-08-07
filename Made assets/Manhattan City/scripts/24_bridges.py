"""
24_bridges.py — East River / Harlem River / Hudson crossings.

Runs inside Blender. Idempotent (purges 09_bridges).

The bridges carry a lot of the "this is New York" read in the reference's
harbour shots, so the four East River suspension crossings get real towers and
catenary main cables with hangers, not just a raised slab.

Selection is by OSM name where the ways are named, with a geographic fallback
for the crossings whose deck ways are unnamed (the Queensboro and the George
Washington both come through as anonymous man_made=bridge outlines).

Deck height ramps in from both shores on a smoothstep so approaches meet the
land instead of ending in a cliff.
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

# name substring -> deck height, tower height, deck width, has main cables
SPECS = [
    ("brooklyn bridge",            40.0,  84.0, 26.0, True),
    ("manhattan bridge",           40.0, 102.0, 36.0, True),
    ("williamsburg bridge",        42.0, 101.0, 36.0, True),
    ("george washington bridge",   65.0, 184.0, 40.0, True),
    ("queensboro bridge",          40.0, 107.0, 30.0, False),
    ("ed koch",                    40.0, 107.0, 30.0, False),
    ("robert f. kennedy bridge",   43.0,  96.0, 26.0, True),
    ("triborough",                 43.0,  96.0, 26.0, True),
    ("verrazzano",                 70.0, 211.0, 34.0, True),
    ("washington bridge",          30.0,   0.0, 20.0, False),
    ("macombs dam bridge",         14.0,   0.0, 18.0, False),
    ("high bridge",                26.0,   0.0, 10.0, False),
    ("henry hudson bridge",        43.0,   0.0, 24.0, False),
    ("alexander hamilton bridge",  35.0,   0.0, 26.0, False),
    ("willis avenue bridge",       14.0,   0.0, 18.0, False),
    ("third avenue bridge",        14.0,   0.0, 18.0, False),
    ("madison avenue bridge",      14.0,   0.0, 16.0, False),
    ("145th street bridge",        14.0,   0.0, 16.0, False),
    ("university heights bridge",  14.0,   0.0, 16.0, False),
    ("broadway bridge",            15.0,   0.0, 18.0, False),
    ("pulaski",                    18.0,   0.0, 20.0, False),
]

# geographic fallback for the crossings whose ways carry no name
# (x0, x1, y0, y1, label, deck, tower, width, cables)
BOXES = [
    (2200, 4600, -2400, -1200, "Queensboro",       40.0, 107.0, 30.0, False),
    (-4600, -1500, 8600, 10200, "GeorgeWashington", 65.0, 184.0, 40.0, True),
]

MIN_LEN = 150.0


def spec_for(seg):
    nm = (seg.get("name") or "").lower()
    for key, deck, tower, w, cab in SPECS:
        if key in nm:
            return key, deck, tower, w, cab
    p = seg["pts"]
    cx = sum(q[0] for q in p) / len(p)
    cy = sum(q[1] for q in p) / len(p)
    for (x0, x1, y0, y1, lab, deck, tower, w, cab) in BOXES:
        if x0 <= cx <= x1 and y0 <= cy <= y1 and seg["len"] > 400.0:
            return lab, deck, tower, w, cab
    return None


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def height_profile(pts, deck_h, ramp_frac=0.24):
    """Cumulative-length based deck height: ramps up from both shores."""
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.dist(pts[i], pts[i + 1]))
    total = cum[-1] or 1.0
    out = []
    for c in cum:
        t = c / total
        a = smoothstep(t / ramp_frac) if t < ramp_frac else 1.0
        b = smoothstep((1.0 - t) / ramp_frac) if t > 1.0 - ramp_frac else 1.0
        out.append(bc.LAND_LEVEL + deck_h * min(a, b))
    return out, cum, total


def deck_ribbon(V, F, pts, zs, w):
    n = len(pts)
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
        V.append((x + nx, y + ny, zs[i]))
        V.append((x - nx, y - ny, zs[i]))
        V.append((x + nx, y + ny, zs[i] - 2.6))     # deck thickness
        V.append((x - nx, y - ny, zs[i] - 2.6))
    for i in range(n - 1):
        a, b = base + 4 * i, base + 4 * (i + 1)
        F.append((a, b, b + 1, a + 1))              # roadway
        F.append((a + 2, a + 3, b + 3, b + 2))      # underside
        F.append((a, a + 2, b + 2, b))              # side
        F.append((a + 1, b + 1, b + 3, a + 3))      # side


def at_frac(pts, cum, total, f):
    """Point and tangent at fractional distance along the polyline."""
    target = total * f
    for i in range(len(cum) - 1):
        if cum[i] <= target <= cum[i + 1]:
            seg = cum[i + 1] - cum[i] or 1.0
            t = (target - cum[i]) / seg
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
            dx = pts[i + 1][0] - pts[i][0]
            dy = pts[i + 1][1] - pts[i][1]
            L = math.hypot(dx, dy) or 1.0
            return (x, y), (dx / L, dy / L)
    return pts[-1], (1.0, 0.0)


def add_tower(V, F, x, y, tx, ty, w, h, base_z):
    """Two legs plus a crossbeam, aligned across the deck."""
    px, py = -ty, tx
    leg = 3.2
    for s in (-1, 1):
        cx, cy = x + px * (w * 0.5) * s, y + py * (w * 0.5) * s
        b = len(V)
        V.extend([(cx - leg, cy - leg, base_z), (cx + leg, cy - leg, base_z),
                  (cx + leg, cy + leg, base_z), (cx - leg, cy + leg, base_z),
                  (cx - leg * 0.6, cy - leg * 0.6, base_z + h),
                  (cx + leg * 0.6, cy - leg * 0.6, base_z + h),
                  (cx + leg * 0.6, cy + leg * 0.6, base_z + h),
                  (cx - leg * 0.6, cy + leg * 0.6, base_z + h)])
        for f in ((b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                  (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7),
                  (b + 4, b + 5, b + 6, b + 7)):
            F.append(f)
    # crossbeam near the top
    b = len(V)
    z0 = base_z + h * 0.82
    z1 = base_z + h * 0.90
    for s in (-1, 1):
        for zz in (z0, z1):
            V.append((x + px * (w * 0.5) * s - tx * 1.6,
                      y + py * (w * 0.5) * s - ty * 1.6, zz))
            V.append((x + px * (w * 0.5) * s + tx * 1.6,
                      y + py * (w * 0.5) * s + ty * 1.6, zz))
    F.append((b, b + 1, b + 5, b + 4))
    F.append((b + 2, b + 3, b + 7, b + 6))
    F.append((b, b + 4, b + 6, b + 2))
    F.append((b + 1, b + 3, b + 7, b + 5))


def add_cables(V, F, pts, cum, total, deck_h, tower_h, w, base_z):
    """Main catenary between the towers plus vertical hangers down to the deck."""
    t0, t1 = 0.22, 0.78
    steps = 26
    r = 0.9
    top = base_z + tower_h * 0.88
    sag = tower_h * 0.72
    for s in (-1, 1):
        prev = None
        for k in range(steps + 1):
            f = t0 + (t1 - t0) * k / steps
            (x, y), (tx, ty) = at_frac(pts, cum, total, f)
            px, py = -ty, tx
            u = (k / steps) * 2.0 - 1.0
            z = top - sag * (1.0 - u * u)
            cx = x + px * (w * 0.5) * s
            cy = y + py * (w * 0.5) * s
            b = len(V)
            V.extend([(cx - r, cy - r, z), (cx + r, cy - r, z),
                      (cx + r, cy + r, z), (cx - r, cy + r, z)])
            if prev is not None:
                for q in range(4):
                    F.append((prev + q, prev + (q + 1) % 4,
                              b + (q + 1) % 4, b + q))
            prev = b
            # hanger every other step
            if 0 < k < steps and k % 2 == 0:
                hb = len(V)
                V.extend([(cx - 0.35, cy - 0.35, z), (cx + 0.35, cy - 0.35, z),
                          (cx + 0.35, cy + 0.35, z), (cx - 0.35, cy + 0.35, z),
                          (cx - 0.35, cy - 0.35, base_z + deck_h),
                          (cx + 0.35, cy - 0.35, base_z + deck_h),
                          (cx + 0.35, cy + 0.35, base_z + deck_h),
                          (cx - 0.35, cy + 0.35, base_z + deck_h)])
                for f2 in ((hb, hb + 1, hb + 5, hb + 4),
                           (hb + 1, hb + 2, hb + 6, hb + 5),
                           (hb + 2, hb + 3, hb + 7, hb + 6),
                           (hb + 3, hb, hb + 4, hb + 7)):
                    F.append(f2)


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
    return ob


def main():
    t0 = time.time()
    bc.purge_collection("09_bridges")

    spans = pickle.load(open(os.path.join(bc.CACHE, "bridges.pkl"), "rb"))
    mat_c = bpy.data.materials.get("MAT_concrete")
    mat_s = bpy.data.materials.get("MAT_steel")
    mat_k = bpy.data.materials.get("MAT_cable")

    # group all spans of one crossing so the longest becomes the main deck
    groups = {}
    for s in spans:
        if s["len"] < MIN_LEN:
            continue
        sp = spec_for(s)
        if not sp:
            continue
        key = sp[0]
        groups.setdefault(key, {"spec": sp, "segs": []})["segs"].append(s)

    Vd, Fd = [], []
    Vt, Ft = [], []
    Vc, Fc = [], []
    built = []

    for key, g in groups.items():
        _, deck_h, tower_h, w, cables = g["spec"]
        segs = sorted(g["segs"], key=lambda s: -s["len"])
        main_seg = segs[0]
        pts = main_seg["pts"]
        if len(pts) < 2:
            continue
        zs, cum, total = height_profile(pts, deck_h)
        deck_ribbon(Vd, Fd, pts, zs, w)

        if tower_h > 0.0:
            for f in (0.22, 0.78):
                (x, y), (tx, ty) = at_frac(pts, cum, total, f)
                add_tower(Vt, Ft, x, y, tx, ty, w, tower_h, bc.LAND_LEVEL)
            if cables:
                add_cables(Vc, Fc, pts, cum, total, deck_h, tower_h, w,
                           bc.LAND_LEVEL)

        # secondary approach spans at a lower, flatter height
        for s in segs[1:6]:
            if s["len"] < 220.0:
                continue
            p2 = s["pts"]
            z2, _, _ = height_profile(p2, deck_h * 0.55)
            deck_ribbon(Vd, Fd, p2, z2, max(8.0, w * 0.55))

        built.append({"crossing": key, "spans": len(segs),
                      "len": round(main_seg["len"]), "towers": tower_h > 0,
                      "cables": cables})

    mesh_from("BRIDGE_decks", Vd, Fd, mat_c, "09_bridges")
    mesh_from("BRIDGE_towers", Vt, Ft, mat_s, "09_bridges")
    mesh_from("BRIDGE_cables", Vc, Fc, mat_k, "09_bridges")

    return {"crossings": len(built),
            "detail": sorted(built, key=lambda b: -b["len"])[:12],
            "deck_verts": len(Vd), "tower_verts": len(Vt),
            "cable_verts": len(Vc),
            "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    result = main()
    print(result)
