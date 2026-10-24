"""
Shenron City vehicle family: original, fictional cars authored in code.

    python3 scripts/blender/vehicles/build_vehicles.py            # export GLB
    python3 scripts/blender/vehicles/build_vehicles.py --preview DIR [--kinds sedan,taxi]

Every car is lofted from a handful of side-profile and plan-view curves
(bottom, shoulder, deck crown, roof, half-width, roof half-width) through a
fixed cross-section ring, so the whole family is ~6 parameter tables rather
than hand-pushed vertices. Wheel wells are part of the loft (the ring's outer
points are lifted onto the arch circle), glass is a face region of the same
surface that is then inset into a rubber seal, and the lamps, grille, plates,
door seams and liveries are projected onto the body with a BVH ray cast so
they wrap the curvature.

Nothing here is a real make or model. There are no badges, logos or text.

Output: public/models/vehicles/vehicles.glb, one root node per kind:

    <kind>                 empty at the footprint centre, wheels on the ground
      <kind>_body          LOD0 body: paint, glass, trim, lamps, interior ...
      <kind>_wheel_FL/FR/RL/RR   one shared wheel mesh, origin at the hub
      <kind>_lod1          ~350 tris, wheels merged, for mid-distance traffic
      <kind>_lod2          ~100 tris, for far traffic

Conventions (glTF / three.js space after export): +Y up, +Z forward, the
car's left side is +X. The runtime reads material names (VEH_*) to drive
paint colour, clearcoat, glass, lamp emissive and the police lightbar.
"""
import argparse
import math
import os
import sys

import bpy  # noqa: I001 -- bpy must load before bmesh/mathutils
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'public', 'models', 'vehicles', 'vehicles.glb')

# ── Materials ────────────────────────────────────────────────────────────────
# Base colours are linear. The runtime replaces every material by name, so
# these only have to read correctly in a glTF viewer.
MATS = {
    'paint': dict(color=(0.8, 0.8, 0.8), rough=0.25, metal=0.0),
    'glass': dict(color=(0.02, 0.025, 0.03), rough=0.04, metal=0.0, alpha=0.4),
    'trim': dict(color=(0.018, 0.018, 0.02), rough=0.55, metal=0.0),
    'chrome': dict(color=(0.85, 0.85, 0.88), rough=0.1, metal=1.0),
    'rubber': dict(color=(0.022, 0.022, 0.022), rough=0.92, metal=0.0),
    'rim': dict(color=(0.6, 0.61, 0.63), rough=0.28, metal=1.0),
    'headlight': dict(color=(0.9, 0.9, 0.86), rough=0.08, metal=0.0, emit=(1.0, 0.95, 0.85)),
    'taillight': dict(color=(0.45, 0.01, 0.01), rough=0.15, metal=0.0, emit=(1.0, 0.05, 0.03)),
    'indicator': dict(color=(0.8, 0.35, 0.02), rough=0.15, metal=0.0, emit=(1.0, 0.45, 0.05)),
    'interior': dict(color=(0.045, 0.045, 0.05), rough=0.85, metal=0.0),
    'plate': dict(color=(0.8, 0.8, 0.75), rough=0.45, metal=0.0),
    'well': dict(color=(0.012, 0.012, 0.012), rough=0.95, metal=0.0),
    'livery': dict(color=(0.03, 0.07, 0.25), rough=0.3, metal=0.0),
    'livery_dark': dict(color=(0.015, 0.015, 0.015), rough=0.35, metal=0.0),
    'lightbar_red': dict(color=(0.5, 0.02, 0.02), rough=0.1, metal=0.0, emit=(1.0, 0.03, 0.02)),
    'lightbar_blue': dict(color=(0.02, 0.05, 0.6), rough=0.1, metal=0.0, emit=(0.05, 0.2, 1.0)),
    'taxi_sign': dict(color=(0.85, 0.75, 0.45), rough=0.3, metal=0.0, emit=(1.0, 0.85, 0.5)),
}
MAT_ORDER = list(MATS.keys())
MI = {name: i for i, name in enumerate(MAT_ORDER)}


def build_materials():
    out = {}
    for name, spec in MATS.items():
        m = bpy.data.materials.new('VEH_' + name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*spec['color'], 1.0)
        bsdf.inputs['Roughness'].default_value = spec['rough']
        bsdf.inputs['Metallic'].default_value = spec['metal']
        if 'alpha' in spec:
            bsdf.inputs['Alpha'].default_value = spec['alpha']
            m.blend_method = 'BLEND'
        if 'emit' in spec:
            bsdf.inputs['Emission Color'].default_value = (*spec['emit'], 1.0)
            bsdf.inputs['Emission Strength'].default_value = 0.0
        out[name] = m
    return out


# ── Curves ───────────────────────────────────────────────────────────────────

def curve(points):
    """Monotone cubic (Fritsch-Carlson) through (u, value) control points."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    n = len(points)
    d = [(ys[i + 1] - ys[i]) / max(1e-9, xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [0.0] * n
    m[0] = d[0]
    m[-1] = d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            m[i] = (d[i - 1] + d[i]) / 2
    for i in range(n - 1):
        if abs(d[i]) < 1e-12:
            m[i] = m[i + 1] = 0.0
            continue
        a = m[i] / d[i]
        b = m[i + 1] / d[i]
        s = a * a + b * b
        if s > 9:
            t = 3 / math.sqrt(s)
            m[i] = t * a * d[i]
            m[i + 1] = t * b * d[i]

    def f(u):
        if u <= xs[0]:
            return ys[0]
        if u >= xs[-1]:
            return ys[-1]
        i = 0
        while i < n - 2 and u > xs[i + 1]:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (u - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1])
    return f


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ── Kinds ────────────────────────────────────────────────────────────────────
# u runs from the rear bumper (0) to the front bumper (L). Landmarks:
#   rw0  rear-window base (deck ends)      rw1  roof rear
#   ws1  roof front / windshield top       ws0  cowl / windshield base
#   B    B-pillar (None for a two-door)     axles: (rear, front)

SEDAN = dict(
    L=4.78, W=1.86, wheel_r=0.335, tyre_w=0.23, axles=(1.02, 3.84), track_in=0.035,
    rw0=1.02, rw1=1.78, B=2.56, ws1=2.86, ws0=3.66,
    bottom=[(0, 0.42), (0.22, 0.27), (0.7, 0.21), (4.1, 0.21), (4.55, 0.27), (4.78, 0.36)],
    belt=[(0, 0.82), (0.1, 0.96), (0.9, 1.0), (2.4, 0.975), (3.66, 0.925), (4.35, 0.865), (4.64, 0.81), (4.78, 0.7)],
    deck=[(0, 0.84), (0.1, 0.985), (0.9, 1.03), (1.02, 1.035), (3.66, 0.975), (4.35, 0.905), (4.64, 0.835), (4.78, 0.72)],
    roof=[(1.02, 1.035), (1.25, 1.2), (1.55, 1.37), (1.78, 1.435), (2.3, 1.458), (2.86, 1.44), (3.25, 1.24), (3.66, 0.975)],
    width=[(0, 0.8), (0.07, 0.87), (0.3, 0.915), (1.0, 0.93), (3.8, 0.93), (4.45, 0.9), (4.66, 0.845), (4.78, 0.76)],
    roofw=[(1.02, 0.83), (1.78, 0.72), (2.4, 0.72), (2.86, 0.725), (3.66, 0.845)],
    lamps=dict(head=(0.46, 0.87, 0.62, 0.73), tail=(0.42, 0.9, 0.7, 0.82), grille=(0.38, 0.52, 0.66),
               intake=(0.66, 0.29, 0.39), plate_f=0.4, plate_r=0.52),
    seats=True,
)

TAXI = dict(SEDAN, extras=('taxi_sign', 'checker'))

POLICE = dict(SEDAN, extras=('lightbar', 'pushbar', 'police_stripe', 'spotlight'))

SUV = dict(
    L=4.95, W=1.96, wheel_r=0.385, tyre_w=0.255, axles=(1.02, 3.98), track_in=0.04,
    rw0=0.1, rw1=0.3, B=2.62, ws1=3.08, ws0=3.86,
    bottom=[(0, 0.5), (0.2, 0.34), (0.6, 0.29), (4.3, 0.29), (4.75, 0.36), (4.95, 0.46)],
    belt=[(0, 0.98), (0.08, 1.1), (0.8, 1.14), (2.5, 1.12), (3.86, 1.07), (4.5, 1.02), (4.8, 0.97), (4.95, 0.86)],
    deck=[(0, 1.0), (0.08, 1.12), (0.1, 1.13), (3.86, 1.11), (4.5, 1.06), (4.8, 1.0), (4.95, 0.88)],
    roof=[(0.1, 1.13), (0.13, 1.5), (0.22, 1.72), (0.3, 1.77), (1.5, 1.8), (3.08, 1.79), (3.45, 1.52), (3.86, 1.11)],
    width=[(0, 0.86), (0.06, 0.93), (0.25, 0.97), (1.0, 0.98), (4.0, 0.98), (4.6, 0.955), (4.85, 0.9), (4.95, 0.82)],
    roofw=[(0.1, 0.84), (0.3, 0.8), (1.5, 0.8), (3.08, 0.8), (3.86, 0.88)],
    lamps=dict(head=(0.5, 0.9, 0.8, 0.9), tail=(0.62, 0.94, 0.98, 1.3), grille=(0.48, 0.62, 0.84),
               intake=(0.7, 0.34, 0.5), plate_f=0.52, plate_r=0.72),
    seats=True,
    extras=('roof_rails',),
)

VAN = dict(
    L=5.35, W=2.0, wheel_r=0.36, tyre_w=0.235, axles=(1.12, 4.42), track_in=0.05,
    rw0=0.03, rw1=0.1, B=3.95, ws1=4.33, ws0=4.72,
    bottom=[(0, 0.44), (0.12, 0.33), (0.4, 0.3), (4.9, 0.3), (5.2, 0.36), (5.35, 0.42)],
    belt=[(0, 1.04), (0.05, 1.12), (0.5, 1.14), (4.0, 1.13), (4.72, 1.06), (5.1, 0.98), (5.35, 0.86)],
    deck=[(0, 1.06), (0.05, 1.13), (0.1, 1.14), (4.72, 1.1), (5.1, 1.02), (5.35, 0.88)],
    roof=[(0.03, 1.14), (0.05, 2.1), (0.1, 2.28), (0.3, 2.34), (3.9, 2.34), (4.18, 2.3), (4.3, 2.02), (4.5, 1.62), (4.72, 1.1)],
    width=[(0, 0.93), (0.05, 0.99), (0.2, 1.0), (4.9, 1.0), (5.2, 0.97), (5.35, 0.88)],
    roofw=[(0.03, 0.95), (0.3, 0.94), (3.9, 0.94), (4.28, 0.9), (4.72, 0.93)],
    lamps=dict(head=(0.52, 0.92, 0.8, 0.92), tail=(0.84, 0.97, 0.6, 1.25), grille=(0.52, 0.62, 0.86),
               intake=(0.75, 0.33, 0.47), plate_f=0.5, plate_r=0.52),
    seats=True, cargo=True, side_glass=(3.95, 4.62), no_rear_glass=True,
    extras=('van_doors',),
)

COUPE = dict(
    L=4.52, W=1.9, wheel_r=0.34, tyre_w=0.255, axles=(0.98, 3.64), track_in=0.03,
    rw0=0.5, rw1=1.55, B=None, ws1=2.5, ws0=3.4,
    bottom=[(0, 0.36), (0.2, 0.22), (0.6, 0.16), (3.9, 0.16), (4.3, 0.2), (4.52, 0.27)],
    belt=[(0, 0.8), (0.08, 0.9), (0.6, 0.93), (1.2, 0.93), (2.4, 0.9), (3.4, 0.83), (4.1, 0.76), (4.4, 0.69), (4.52, 0.58)],
    deck=[(0, 0.82), (0.08, 0.93), (0.4, 0.96), (0.5, 0.965), (3.4, 0.86), (4.1, 0.79), (4.4, 0.72), (4.52, 0.6)],
    roof=[(0.5, 0.965), (0.9, 1.1), (1.3, 1.22), (1.55, 1.27), (2.1, 1.3), (2.5, 1.285), (2.95, 1.1), (3.4, 0.86)],
    width=[(0, 0.84), (0.07, 0.92), (0.3, 0.95), (1.1, 0.955), (2.2, 0.93), (3.6, 0.935), (4.2, 0.9), (4.42, 0.84), (4.52, 0.76)],
    roofw=[(0.5, 0.8), (1.55, 0.66), (2.5, 0.68), (3.4, 0.84)],
    lamps=dict(head=(0.5, 0.88, 0.58, 0.66), tail=(0.35, 0.92, 0.74, 0.82), grille=(0.34, 0.4, 0.52),
               intake=(0.72, 0.2, 0.34), plate_f=0.35, plate_r=0.5),
    seats=True, two_door=True, side_glass=(1.45, 3.3),
    extras=('spoiler', 'exhaust'),
)

KINDS = {
    'sedan': SEDAN,
    'taxi': TAXI,
    'police': POLICE,
    'suv': SUV,
    'van': VAN,
    'coupe': COUPE,
}


# ── The loft ─────────────────────────────────────────────────────────────────

class Body:
    """Evaluates the profile curves of one kind at a station u."""

    def __init__(self, k):
        self.k = k
        self.L = k['L']
        self.bottom = curve(k['bottom'])
        self.belt = curve(k['belt'])
        self.deck = curve(k['deck'])
        self.roof = curve(k['roof'])
        self.width = curve(k['width'])
        self.roofw = curve(k['roofw'])
        self.cab0 = k['roof'][0][0]
        self.arches = True
        self.cab1 = k['roof'][-1][0]

    def arch(self, u):
        """Height of the wheel-arch opening at u, or None outside the arches."""
        k = self.k
        R = k['wheel_r'] + 0.075
        best = None
        for ua in k['axles']:
            du = u - ua
            if abs(du) < R:
                z = k['wheel_r'] + math.sqrt(R * R - du * du)
                best = z if best is None else max(best, z)
        return best

    def cabin(self, u):
        """0 on the deck/hood, 1 where the greenhouse has full height."""
        if u <= self.cab0 or u >= self.cab1:
            return 0.0
        rise = self.roof(u) - self.deck(u)
        return max(0.0, min(1.0, rise / 0.16))

    def ring(self, u, coarse=False):
        """Half cross-section, bottom centre -> roof centre, as (v, z) pairs."""
        zb = self.bottom(u)
        w = self.width(u)
        zbelt = self.belt(u)
        zdeck = self.deck(u)
        zr = self.roof(u) if self.cab0 < u < self.cab1 else zdeck
        wr = self.roofw(u) if self.cab0 < u < self.cab1 else w - 0.08
        c = self.cabin(u)
        zs = zb + 0.13
        mid = zs + (zbelt - zs) * 0.45
        # fenders swell a little over each wheel
        R = self.k['wheel_r'] + 0.075
        bulge = 0.0
        for ua in self.k['axles']:
            bulge = max(bulge, 1 - smooth(R * 0.6, R * 1.5, abs(u - ua)))
        fl = 0.018 * bulge
        # lower body
        pts = [
            (0.0, zb),
            (w * 0.55, zb),
            (w - 0.34, zb),
            (w - 0.30, zb + 0.005),
            (w - 0.07, zb + 0.015),
            (w - 0.025 + fl, zs),
            (w + 0.018 + fl, mid),
            (w + 0.006 + fl * 0.5, zbelt - 0.085),
            (w - 0.035, zbelt - 0.005),
        ]
        # greenhouse / hood crown: blend between the crown curve of the deck
        # and the cabin cross-section by the cabin factor
        g0 = (w - 0.075, zbelt + 0.012)
        crown = []
        for t in (0.25, 0.55, 0.8, 0.93, 1.0):
            v = g0[0] * (1 - t)
            z = zdeck - (zdeck - g0[1]) * (1 - t) ** 2
            crown.append((v, z))
        cab = [
            (g0[0] + (wr + 0.03 - g0[0]) * 0.5 + 0.006, g0[1] + (zr - 0.075 - g0[1]) * 0.5),
            (wr + 0.03, zr - 0.075),
            (wr - 0.045, zr - 0.006),
            (wr * 0.55, zr + 0.022),
            (0.0, zr + 0.03),
        ]
        green = [g0] + [(a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c) for a, b in zip(crown, cab)]
        pts += green
        # wheel wells: lift the outer points onto the arch circle
        za = self.arch(u) if self.arches else None
        if za is not None:
            lifted = []
            for i, (v, z) in enumerate(pts):
                if i >= 3 and v > w - 0.33 and z < za:
                    z = za
                lifted.append((v, z))
            pts = lifted
        if coarse:
            keep = (0, 2, 5, 6, 8, 9, 11, 12, 14)
            pts = [pts[i] for i in keep]
        return pts


# Band indices in the full-resolution half ring (between point i and i+1):
#  0,1 underbody  2 well inner  3,4 rocker/well roof  5,6 side  7 shoulder
#  8 seal  9,10 side glass  11 roof rail / pillar  12,13 roof / windshield
def classify(body, k, u0, u1, band, coarse=False):
    um = (u0 + u1) / 2
    za = body.arch(um)
    if coarse:
        # coarse bands: 0 under, 1 well/rocker, 2 lower side, 3 upper side,
        # 4 shoulder, 5 side glass, 6 rail, 7 roof / screens
        if band <= 1:
            return 'well'
        if band == 5:
            return 'glass' if side_glass(body, k, um) else 'paint'
        if band == 7:
            return 'glass' if screen_glass(body, k, um) else 'paint'
        return 'paint'
    if band <= 1:
        return 'well'
    if band in (2, 3, 4) and za is not None:
        return 'well'
    if band == 2:
        return 'well'
    if band in (9, 10):
        return 'glass' if side_glass(body, k, um) else 'paint'
    if band in (12, 13):
        return 'glass' if screen_glass(body, k, um) else 'paint'
    return 'paint'


def side_glass(body, k, u):
    if body.cabin(u) < 0.35:
        return False
    lo, hi = k.get('side_glass', (k['rw1'] + 0.03, k['ws0'] - 0.1))
    if not (lo < u < hi):
        return False
    B = k.get('B')
    if B is not None and not k.get('two_door') and abs(u - B) < 0.05:
        return False
    return True


def screen_glass(body, k, u):
    if k['ws1'] + 0.015 < u < k['ws0'] - 0.03:
        return True
    if not k.get('no_rear_glass') and k['rw0'] + 0.035 < u < k['rw1'] - 0.015:
        return True
    return False


def stations(body, k, step, coarse=False, arches=True):
    L = k['L']
    us = set()
    n = max(2, int(round(L / step)))
    for i in range(n + 1):
        us.add(round(L * i / n, 5))
    if not coarse:
        for key in ('rw0', 'rw1', 'ws1', 'ws0'):
            us.add(k[key])
        if k.get('B') is not None and not k.get('two_door'):
            us.add(k['B'] - 0.05)
            us.add(k['B'] + 0.05)
        lo, hi = k.get('side_glass', (k['rw1'] + 0.03, k['ws0'] - 0.1))
        us.update([lo, hi, k['ws1'] + 0.015, k['ws0'] - 0.03, k['rw0'] + 0.035, k['rw1'] - 0.015])
        R = k['wheel_r'] + 0.075
        for ua in k['axles']:
            for i in range(17):
                us.add(round(ua - R * math.cos(math.pi * i / 16), 5))
        for e in (0.012, 0.03, 0.055, 0.085):
            us.add(e)
            us.add(L - e)
    elif arches:
        R = k['wheel_r'] + 0.075
        for key in ('rw0', 'rw1', 'ws1', 'ws0'):
            us.add(k[key])
        for ua in k['axles']:
            for f in (-0.8, -0.4, 0.0, 0.4, 0.8):
                us.add(round(ua + R * f, 5))
    ordered = sorted(u for u in us if 0 <= u <= L)
    out = []
    for u in ordered:
        if out and u - out[-1] < 0.008:
            continue
        out.append(u)
    if out[-1] != L:
        out[-1] = L
    return out


def loft(bm, k, step, coarse=False, y_of=None, arches=True):
    """Loft the body into bm. Returns the list of glass faces."""
    body = Body(k)
    body.arches = arches
    us = stations(body, k, step, coarse, arches)
    rings = []
    for u in us:
        half = body.ring(u, coarse)
        full = half + [(-v, z) for (v, z) in reversed(half[1:-1])]
        y = y_of(u)
        rings.append([bm.verts.new((v, y, z)) for (v, z) in full])
    nh = len(body.ring(us[0], coarse))
    nfull = len(rings[0])
    glass = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(nfull):
            jn = (j + 1) % nfull
            # left side climbs bands 0..nh-2; the mirrored right side
            # descends them again
            band = j if j < nh - 1 else nfull - j - 1
            try:
                f = bm.faces.new((a[j], b[j], b[jn], a[jn]))
            except ValueError:
                continue
            mat = classify(body, k, us[i], us[i + 1], band, coarse)
            f.material_index = MI[mat]
            if mat == 'glass':
                glass.append(f)
    # caps with a small bevel ring so the fascia edge catches light
    for idx, sign in ((0, 1), (len(rings) - 1, -1)):
        ring = rings[idx]
        cx = 0.0
        cz = sum(v.co.z for v in ring) / len(ring)
        y = ring[0].co.y
        inner = [bm.verts.new((v.co.x * 0.93 + cx * 0.07, y - sign * 0.012, v.co.z * 0.93 + cz * 0.07)) for v in ring]
        for j in range(len(ring)):
            jn = (j + 1) % len(ring)
            try:
                f = bm.faces.new((ring[j], ring[jn], inner[jn], inner[j]))
                f.material_index = MI['paint'] if ring[j].co.z > body.bottom(us[idx]) + 0.02 else MI['well']
            except ValueError:
                pass
        try:
            f = bm.faces.new(inner)
            f.material_index = MI['paint']
        except ValueError:
            pass
    return glass


# ── Geometry helpers ─────────────────────────────────────────────────────────

def add_box(bm, center, size, mat, rot=None, bevel=0.0):
    """Axis box (optionally rotated about Z then placed) with an optional bevel."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res['verts']
    m = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    if rot is not None:
        m = rot.to_4x4() @ m
    m = Matrix.Translation(center) @ m
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    faces = list({f for v in verts for f in v.link_faces})
    for f in faces:
        f.material_index = MI[mat]
    if bevel > 0:
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, affect='EDGES', profile=0.5)
    return verts


def add_cylinder(bm, center, radius, depth, axis, mat, segments=12, cap_mat=None):
    res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                radius1=radius, radius2=radius, depth=depth)
    verts = res['verts']
    if axis == 'X':
        rot = Matrix.Rotation(math.pi / 2, 4, 'Y')
    elif axis == 'Y':
        rot = Matrix.Rotation(math.pi / 2, 4, 'X')
    else:
        rot = Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ rot, verts=verts)
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = MI[mat]
    return verts


def project_quad(bm, bvh, corners, direction, offset, mat, nx=4, ny=2):
    """
    Project a bilinear quad (4 corners, outside the body) onto the body along
    `direction`, lifting it `offset` metres off the surface along the hit
    normal. Returns the created faces (empty if the quad missed the body).
    """
    d = Vector(direction).normalized()
    grid = []
    for j in range(ny + 1):
        row = []
        t = j / ny
        for i in range(nx + 1):
            s = i / nx
            a = corners[0].lerp(corners[1], s)
            b = corners[3].lerp(corners[2], s)
            p = a.lerp(b, t)
            hit = bvh.ray_cast(p, d, 5.0)
            if hit[0] is None:
                row.append(None)
                continue
            n = hit[1]
            if n.dot(d) > 0:
                n = -n
            row.append(bm.verts.new(hit[0] + n * offset))
        grid.append(row)
    faces = []
    for j in range(ny):
        for i in range(nx):
            q = (grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])
            if any(v is None for v in q):
                continue
            try:
                f = bm.faces.new(q)
            except ValueError:
                continue
            f.material_index = MI[mat]
            faces.append(f)
    # orient toward the viewer (against the projection direction)
    for f in faces:
        f.normal_update()
        if f.normal.dot(d) > 0:
            f.normal_flip()
    return faces


def side_quad(y0, y1, z0, z1, side):
    """Corners of a quad on a plane outside the car's left (+1) or right (-1) side."""
    x = side * 3.0
    return [Vector((x, y0, z0)), Vector((x, y1, z0)), Vector((x, y1, z1)), Vector((x, y0, z1))]


def front_quad(x0, x1, z0, z1, y):
    return [Vector((x0, y, z0)), Vector((x1, y, z0)), Vector((x1, y, z1)), Vector((x0, y, z1))]


# ── Wheels ───────────────────────────────────────────────────────────────────

def build_wheel(bm, r, width, segments=20, lod=0):
    """Tyre and rim around the X axis, hub at the origin, rim face toward +X."""
    hw = width / 2
    rim_r = r * 0.66
    if lod > 0:
        add_cylinder(bm, Vector((0, 0, 0)), r, width, 'X', 'rubber', segments=8)
        return
    # tyre cross-section (x, radius) from the inner sidewall round to the outer
    prof = [
        (-hw * 0.82, rim_r * 1.02),
        (-hw * 0.98, r * 0.8),
        (-hw * 0.92, r * 0.95),
        (-hw * 0.7, r),
        (hw * 0.7, r),
        (hw * 0.92, r * 0.95),
        (hw * 0.98, r * 0.8),
        (hw * 0.82, rim_r * 1.02),
    ]
    rings = []
    for (x, rad) in prof:
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ring.append(bm.verts.new((x, rad * math.cos(a), rad * math.sin(a))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(segments):
            sn = (s + 1) % segments
            f = bm.faces.new((rings[i][s], rings[i][sn], rings[i + 1][sn], rings[i + 1][s]))
            f.material_index = MI['rubber']
    # rim: barrel, lip and a dished face with spokes
    rim_prof = [(hw * 0.82, rim_r * 1.02), (hw * 0.86, rim_r * 0.98), (hw * 0.6, rim_r * 0.9),
                (hw * 0.45, rim_r * 0.35), (hw * 0.5, rim_r * 0.18)]
    rrings = [rings[-1]]
    for (x, rad) in rim_prof[1:]:
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ring.append(bm.verts.new((x, rad * math.cos(a), rad * math.sin(a))))
        rrings.append(ring)
    for i in range(len(rrings) - 1):
        for s in range(segments):
            sn = (s + 1) % segments
            f = bm.faces.new((rrings[i][s], rrings[i][sn], rrings[i + 1][sn], rrings[i + 1][s]))
            # the dish between lip and hub is dark so the spokes read
            f.material_index = MI['rim'] if i < 1 or i == len(rrings) - 2 else MI['well']
    hub = bm.faces.new(list(reversed(rrings[-1])))
    hub.material_index = MI['rim']
    # five spokes
    for s in range(5):
        a = 2 * math.pi * s / 5
        mid = rim_r * 0.6
        c = Vector((hw * 0.62, mid * math.cos(a), mid * math.sin(a)))
        rot = Matrix.Rotation(a, 3, 'X')
        add_box(bm, c, (0.035, rim_r * 0.82, 0.06), 'rim', rot=rot)
    # inner face so the wheel is closed from behind
    back = bm.faces.new(rings[0])
    back.material_index = MI['well']


# ── Assembly ─────────────────────────────────────────────────────────────────

def body_bvh(bm):
    tmp = bm.copy()
    bmesh.ops.triangulate(tmp, faces=tmp.faces)
    bvh = BVHTree.FromBMesh(tmp)
    tmp.free()
    return bvh


def details(bm, k, y_of, lod=0):
    """Lamps, grille, plates, seams, mirrors, interior and kind extras."""
    L = k['L']
    lamps = k['lamps']
    bvh = body_bvh(bm)
    yf = y_of(L) - 1.0   # in front of the nose (front is -Y)
    yr = y_of(0) + 1.0   # behind the tail
    fwd = (0, 1, 0)      # ray from the front plane into the car
    back = (0, -1, 0)
    ns = 1 if lod else 4
    # headlights (front, both sides) and taillights
    x0, x1, z0, z1 = lamps['head']
    wrap = lamps.get('wrap', 0.16)
    for side in (1, -1):
        c = front_quad(side * x0, side * x1, z0, z1, yf)
        project_quad(bm, bvh, c, fwd, 0.006, 'headlight', nx=ns + 1, ny=max(1, ns // 2))
        if lod == 0 and wrap > 0:
            # the lens wraps round the corner onto the fender
            ys = y_of(L - 0.02)
            c = side_quad(ys, ys + wrap, z0 + 0.012, z1 - 0.005, side)
            project_quad(bm, bvh, c, (-side, 0, 0), 0.006, 'headlight', nx=3, ny=1)
        if lod == 0:
            ci = front_quad(side * (x1 - 0.02), side * (x1 + 0.05), z0 + 0.01, z0 + 0.045, yf)
            project_quad(bm, bvh, ci, fwd, 0.007, 'indicator', nx=2, ny=1)
    x0, x1, z0, z1 = lamps['tail']
    for side in (1, -1):
        c = front_quad(side * x0, side * x1, z0, z1, yr)
        project_quad(bm, bvh, c, back, 0.006, 'taillight', nx=ns + 1, ny=max(1, ns // 2))
        if lod == 0 and wrap > 0:
            ys = y_of(0.02)
            c = side_quad(ys - wrap * 0.9, ys, z0 + 0.005, z1 - 0.005, side)
            project_quad(bm, bvh, c, (-side, 0, 0), 0.006, 'taillight', nx=3, ny=1)
    if lod:
        return
    # grille with a chrome surround, lower intake, plates
    gx, gz0, gz1 = lamps['grille']
    project_quad(bm, bvh, front_quad(-gx - 0.02, gx + 0.02, gz0 - 0.02, gz1 + 0.02, yf), fwd, 0.004, 'chrome', nx=6, ny=2)
    project_quad(bm, bvh, front_quad(-gx, gx, gz0, gz1, yf), fwd, 0.007, 'trim', nx=6, ny=2)
    for i in range(3):
        zz = gz0 + (gz1 - gz0) * (i + 1) / 4
        project_quad(bm, bvh, front_quad(-gx + 0.01, gx - 0.01, zz - 0.006, zz + 0.006, yf), fwd, 0.009, 'chrome', nx=6, ny=1)
    ix, iz0, iz1 = lamps['intake']
    project_quad(bm, bvh, front_quad(-ix, ix, iz0, iz1, yf), fwd, 0.005, 'trim', nx=8, ny=1)
    pf = lamps['plate_f']
    project_quad(bm, bvh, front_quad(-0.25, 0.25, pf, pf + 0.11, yf), fwd, 0.01, 'plate', nx=2, ny=1)
    pr = lamps['plate_r']
    project_quad(bm, bvh, front_quad(-0.25, 0.25, pr, pr + 0.12, yr), back, 0.01, 'plate', nx=2, ny=1)
    # rear bumper diffuser band
    zb0 = Body(k).bottom(0.02)
    project_quad(bm, bvh, front_quad(-0.75, 0.75, zb0 + 0.02, zb0 + 0.09, yr), back, 0.005, 'trim', nx=8, ny=1)

    # door seams, handles and a rocker line on both sides
    body = Body(k)
    B = k.get('B')
    seam_w = 0.009
    front_edge = k['ws0'] - 0.06
    seams = []
    if k.get('two_door'):
        seams = [front_edge, (k['rw1'] + k['axles'][0]) / 2 + 0.25]
    elif k.get('cargo'):
        seams = [front_edge, B, B - 0.95, 0.06]
    else:
        seams = [front_edge, B, k['rw1'] + 0.08]
    for side in (1, -1):
        for u in seams:
            if u is None:
                continue
            y = y_of(u)
            zt = body.belt(u) - 0.02
            za = body.arch(u)
            zlo = (za if za is not None else body.bottom(u) + 0.14) + 0.02
            project_quad(bm, bvh, side_quad(y - seam_w / 2, y + seam_w / 2, zlo, zt, side), (-side, 0, 0), 0.002, 'trim', nx=1, ny=4)
        # handles
        hand = [B + 0.12 if B else None, k['rw1'] + 0.28 if not k.get('two_door') and not k.get('cargo') else None]
        if k.get('two_door'):
            hand = [(k['rw1'] + k['axles'][0]) / 2 + 0.4]
        if k.get('cargo'):
            hand = [B + 0.12, B - 0.8]
        for u in hand:
            if u is None:
                continue
            y = y_of(u)
            z = body.belt(u) - 0.075
            project_quad(bm, bvh, side_quad(y - 0.075, y + 0.075, z - 0.014, z + 0.014, side), (-side, 0, 0), 0.008, 'chrome', nx=2, ny=1)
        # mirrors
        um = k['ws0'] - 0.12
        zm = body.belt(um) + 0.07
        wm = body.width(um)
        add_box(bm, Vector((side * (wm + 0.05), y_of(um), zm)), (0.17, 0.08, 0.11), 'paint', bevel=0.022)
        add_box(bm, Vector((side * (wm - 0.02), y_of(um) + 0.01, zm - 0.04)), (0.1, 0.05, 0.04), 'trim')

    kind_extras(bm, bvh, k, y_of, body)
    if k.get('seats'):
        interior(bm, k, y_of, body)


def interior(bm, k, y_of, body):
    ws0 = k['ws0']
    B = k.get('B') or (k['ws1'] + k['rw1']) / 2
    zfloor = body.bottom((ws0 + B) / 2) + 0.12
    wseat = body.roofw((ws0 + B) / 2) * 0.46
    # dashboard
    ud = ws0 - 0.12
    add_box(bm, Vector((0, y_of(ud), body.belt(ud) - 0.05)), (body.width(ud) * 1.7, 0.36, 0.14), 'interior')
    # steering wheel on the left (+X), driver sits there
    us = ud - 0.3
    sw = bmesh.ops.create_cone(bm, cap_ends=False, segments=12, radius1=0.19, radius2=0.19, depth=0.03)
    rot = Matrix.Rotation(math.radians(-62), 4, 'X')
    bmesh.ops.transform(bm, matrix=Matrix.Translation((wseat, y_of(us), body.belt(us) + 0.02)) @ rot, verts=sw['verts'])
    for f in {f for v in sw['verts'] for f in v.link_faces}:
        f.material_index = MI['interior']
    rows = [B + 0.2] if k.get('two_door') or k.get('cargo') else [B + 0.2, (B + k['rw1']) / 2 + 0.1]
    for r, u in enumerate(rows):
        seat_pairs = (1, -1) if r == 0 else (0,)
        for side in seat_pairs:
            x = side * wseat
            sw_ = 0.5 if r == 0 else wseat * 2 + 0.5
            add_box(bm, Vector((x, y_of(u - 0.05), zfloor + 0.2)), (sw_, 0.5, 0.14), 'interior')
            add_box(bm, Vector((x, y_of(u - 0.3), zfloor + 0.55)), (sw_ * 0.92, 0.12, 0.62), 'interior', bevel=0.03)
            if r == 0:
                add_box(bm, Vector((x, y_of(u - 0.33), zfloor + 0.95)), (0.26, 0.1, 0.18), 'interior', bevel=0.03)
    if k.get('cargo'):
        # a bulkhead behind the seats so the cargo box does not read as empty glass
        ub = B - 0.12
        add_box(bm, Vector((0, y_of(ub), body.roof(ub) * 0.5 + zfloor * 0.5)), (body.width(ub) * 1.8, 0.05, body.roof(ub) - zfloor - 0.1), 'interior')


def kind_extras(bm, bvh, k, y_of, body):
    extras = k.get('extras', ())
    roof_mid = (k['rw1'] + k['ws1']) / 2
    if 'taxi_sign' in extras:
        u = roof_mid - 0.1
        z = body.roof(u) + 0.03
        add_box(bm, Vector((0, y_of(u), z + 0.02)), (0.5, 0.2, 0.04), 'trim')
        add_box(bm, Vector((0, y_of(u), z + 0.13)), (0.62, 0.16, 0.2), 'taxi_sign', bevel=0.025)
    if 'checker' in extras:
        for side in (1, -1):
            u0 = k['rw1'] + 0.1
            u1 = k['ws0'] - 0.12
            n = int((u1 - u0) / 0.08)
            for i in range(n):
                uu = u0 + i * 0.08
                for row in range(2):
                    if (i + row) % 2:
                        continue
                    z = body.belt(uu) - 0.19 - row * 0.04
                    project_quad(bm, bvh, side_quad(y_of(uu + 0.08), y_of(uu), z - 0.04, z, side), (-side, 0, 0), 0.003, 'livery_dark', nx=1, ny=1)
    if 'lightbar' in extras:
        u = roof_mid + 0.05
        z = body.roof(u) + 0.03
        add_box(bm, Vector((0, y_of(u), z + 0.02)), (1.1, 0.26, 0.04), 'trim')
        add_box(bm, Vector((0.3, y_of(u), z + 0.09)), (0.5, 0.24, 0.1), 'lightbar_red', bevel=0.02)
        add_box(bm, Vector((-0.3, y_of(u), z + 0.09)), (0.5, 0.24, 0.1), 'lightbar_blue', bevel=0.02)
        add_box(bm, Vector((0, y_of(u), z + 0.09)), (0.1, 0.25, 0.11), 'chrome')
    if 'pushbar' in extras:
        L = k['L']
        yb = y_of(L) - 0.1
        zb = body.bottom(L)
        for side in (1, -1):
            add_box(bm, Vector((side * 0.3, yb, zb + 0.28)), (0.06, 0.08, 0.5), 'trim')
        add_box(bm, Vector((0, yb, zb + 0.46)), (0.72, 0.07, 0.06), 'trim')
        add_box(bm, Vector((0, yb, zb + 0.2)), (0.72, 0.07, 0.06), 'trim')
    if 'police_stripe' in extras:
        for side in (1, -1):
            u0, u1 = 0.35, k['L'] - 0.35
            z = body.belt((u0 + u1) / 2) - 0.2
            project_quad(bm, bvh, side_quad(y_of(u1), y_of(u0), z - 0.06, z + 0.06, side), (-side, 0, 0), 0.003, 'livery', nx=14, ny=1)
    if 'spotlight' in extras:
        u = k['ws0'] - 0.02
        add_cylinder(bm, Vector((0.9, y_of(u), body.belt(u) + 0.1)), 0.06, 0.12, 'Y', 'chrome', segments=10)
    if 'roof_rails' in extras:
        for side in (1, -1):
            u0, u1 = k['rw1'] + 0.1, k['ws1'] - 0.15
            x = side * (body.roofw((u0 + u1) / 2) - 0.08)
            z = body.roof((u0 + u1) / 2) + 0.06
            add_box(bm, Vector((x, (y_of(u0) + y_of(u1)) / 2, z)), (0.04, abs(y_of(u1) - y_of(u0)), 0.035), 'trim')
            for u in (u0 + 0.03, u1 - 0.03):
                add_box(bm, Vector((x, y_of(u), z - 0.03)), (0.05, 0.06, 0.05), 'trim')
    if 'spoiler' in extras:
        u = 0.1
        z = body.deck(u) + 0.03
        add_box(bm, Vector((0, y_of(u), z)), (1.5, 0.16, 0.025), 'paint', bevel=0.008)
    if 'exhaust' in extras:
        zb = body.bottom(0.05)
        for side in (1, -1):
            add_cylinder(bm, Vector((side * 0.52, y_of(0) + 0.02, zb + 0.05)), 0.045, 0.14, 'Y', 'chrome', segments=10)
    if 'van_doors' in extras:
        yr = y_of(0) + 1.0
        # centre split of the rear doors and the side cargo door rail
        project_quad(bm, bvh, front_quad(-0.006, 0.006, body.bottom(0) + 0.1, body.roof(0.2) - 0.05, yr), (0, -1, 0), 0.003, 'trim', nx=1, ny=6)
        for side in (1, -1):
            z = body.roof(2.0) - 0.28
            project_quad(bm, bvh, side_quad(y_of(3.0), y_of(1.9), z - 0.012, z + 0.012, side), (-side, 0, 0), 0.004, 'trim', nx=6, ny=1)


def finish_mesh(bm, name, mats, sharp_angle=48.0):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    thr = math.radians(sharp_angle)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a, b = e.link_faces
            if a.material_index != b.material_index or a.normal.angle(b.normal, 0) > thr:
                e.smooth = False
        else:
            e.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MAT_ORDER:
        me.materials.append(mats[m])
    return me


def inset_glass(bm, glass):
    faces = [f for f in glass if f.is_valid]
    if not faces:
        return
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=0.018, depth=-0.006,
                                 use_even_offset=True, use_boundary=True)
    for f in res['faces']:
        f.material_index = MI['trim']


def build_kind(name, k, mats, collection):
    L = k['L']

    def y_of(u):
        return -(u - L / 2)

    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)

    # LOD0 body
    bm = bmesh.new()
    glass = loft(bm, k, 0.055, coarse=False, y_of=y_of)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    inset_glass(bm, glass)
    details(bm, k, y_of, lod=0)
    me = finish_mesh(bm, f'{name}_body', mats)
    body = bpy.data.objects.new(f'{name}_body', me)
    collection.objects.link(body)
    body.parent = root

    # one wheel mesh, four nodes
    bm = bmesh.new()
    build_wheel(bm, k['wheel_r'], k['tyre_w'])
    wme = finish_mesh(bm, f'{name}_wheel', mats, sharp_angle=40.0)
    half = k['W'] / 2 - k['tyre_w'] / 2 - k['track_in']
    for tag, u, side in (('FL', k['axles'][1], 1), ('FR', k['axles'][1], -1),
                         ('RL', k['axles'][0], 1), ('RR', k['axles'][0], -1)):
        w = bpy.data.objects.new(f'{name}_wheel_{tag}', wme)
        collection.objects.link(w)
        w.parent = root
        w.location = (side * half, y_of(u), k['wheel_r'])
        if side < 0:
            w.rotation_euler = (0, 0, math.pi)

    # LOD1 and LOD2: coarse loft, lamps, boxy wheels
    for lod, step in ((1, 0.6), (2, 1.2)):
        bm = bmesh.new()
        loft(bm, k, step, coarse=True, y_of=y_of, arches=lod == 1)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        details(bm, k, y_of, lod=lod)
        for u in k['axles']:
            for side in (1, -1):
                c = Vector((side * half, y_of(u), k['wheel_r']))
                if lod == 1:
                    add_cylinder(bm, c, k['wheel_r'], k['tyre_w'], 'X', 'rubber', segments=8)
                else:
                    add_box(bm, c, (k['tyre_w'], k['wheel_r'] * 1.8, k['wheel_r'] * 1.8), 'rubber')
        me = finish_mesh(bm, f'{name}_lod{lod}', mats, sharp_angle=60.0)
        o = bpy.data.objects.new(f'{name}_lod{lod}', me)
        collection.objects.link(o)
        o.parent = root
    return root


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def build(kinds):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = build_materials()
    col = bpy.context.scene.collection
    roots = {}
    for name in kinds:
        roots[name] = build_kind(name, KINDS[name], mats, col)
    for name, root in roots.items():
        body = bpy.data.objects[f'{name}_body']
        wheel = bpy.data.objects[f'{name}_wheel_FL']
        l1 = bpy.data.objects[f'{name}_lod1']
        l2 = bpy.data.objects[f'{name}_lod2']
        print(f'[vehicles] {name:7s} body {tri_count(body):6d} tris, wheel {tri_count(wheel):4d} x4, '
              f'lod1 {tri_count(l1):5d}, lod2 {tri_count(l2):4d}')
    return roots


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='NONE',
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
        export_extras=False,
    )
    print('[vehicles] wrote', path, os.path.getsize(path), 'bytes')


# ── Preview (Cycles, for iterating on shapes) ────────────────────────────────

VIEWS = ['q', 'r', 's']


def preview(out_dir, kinds, roots):
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 640, 400
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(28)
    sky.sun_rotation = math.radians(200)
    nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    nt.nodes['Background'].inputs['Strength'].default_value = 0.35
    ground = bpy.data.meshes.new('ground')
    gbm = bmesh.new()
    bmesh.ops.create_grid(gbm, x_segments=1, y_segments=1, size=40)
    gbm.to_mesh(ground)
    gbm.free()
    gobj = bpy.data.objects.new('ground', ground)
    gm = bpy.data.materials.new('ground')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.08, 0.085, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    ground.materials.append(gm)
    sc.collection.objects.link(gobj)
    # tint paint per kind for the preview
    tint = {'sedan': (0.35, 0.04, 0.04), 'taxi': (0.9, 0.55, 0.05), 'police': (0.85, 0.85, 0.85),
            'suv': (0.02, 0.05, 0.1), 'van': (0.8, 0.8, 0.8), 'coupe': (0.05, 0.15, 0.45)}
    paint = bpy.data.materials['VEH_paint']
    gl = bpy.data.materials['VEH_glass'].node_tree.nodes['Principled BSDF']
    gl.inputs['Alpha'].default_value = 0.85
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 40
    for name in kinds:
        for other, r in roots.items():
            vis = other == name
            for o in [r] + list(r.children):
                o.hide_render = not vis or o.name.endswith('_lod1') or o.name.endswith('_lod2')
        paint.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*tint.get(name, (0.5, 0.5, 0.5)), 1)
        paint.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value = 1.0
        for view, (loc, tgt) in {
            'q': ((4.6, -5.4, 1.9), (0, 0, 0.7)),
            'r': ((-4.4, 4.9, 1.8), (0, 0, 0.7)),
            's': ((7.5, 0.0, 1.1), (0, 0, 0.75)),
        }.items():
            if view not in VIEWS:
                continue
            cam.location = loc
            d = Vector(tgt) - Vector(loc)
            cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(out_dir, f'{name}_{view}.png')
            bpy.ops.render.render(write_still=True)
            print('[preview]', sc.render.filepath)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--preview', default=None)
    ap.add_argument('--kinds', default=','.join(KINDS.keys()))
    ap.add_argument('--views', default='q,r,s')
    args = ap.parse_args(argv)
    kinds = [k for k in args.kinds.split(',') if k]
    VIEWS[:] = args.views.split(',')
    roots = build(kinds)
    if args.preview:
        preview(args.preview, kinds, roots)
    else:
        export(args.out)


if __name__ == '__main__':
    main()
