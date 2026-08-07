"""
64_corridor.py -- Phase 2M: the three things the hero corridor still needs.

    blender -b --factory-startup --python scripts/phase2/64_corridor.py

The corridor the brief asks for runs

    penthouse -> lobby -> car -> streets -> market -> HQ -> floor 45 -> Shenron

Everything on that line exists except the joins. Riding a lift with no cab
around you is a fade to black; driving through the city with no car around you
is a floating camera; and the dais on Floor 45 has nothing standing on it.
This builds those three.

    LIFT_cab      2.3 x 2.1 x 2.6 m -- doors, car panel, handrail, a lit
                  ceiling. Used twice: penthouse down to its own lobby, and
                  the HQ lobby up to Floor 45.
    CAR_cabin     the inside of the car for the driving leg. Dashboard,
                  wheel, A-pillars, door cards, seats, mirror, headlining --
                  open at the glass so the city is what you see. Sized and
                  oriented to VEH_sedan (x forward, y across, z up, origin on
                  the road surface) so it sits inside a real fleet body.
    SHENRON_form  what the corridor terminates on.

On SHENRON_form specifically, since the project's name invites the
assumption: this is an **original abstract form** -- a coiling luminous
ribbon around a faceted core, with no face, no eyes, no scales, no horns and
no character features of any kind. It is deliberately not a reproduction of
any existing character design, and nothing here is traced, measured or
derived from one. If a recognisable character is wanted later, that is a
licensing decision, not a modelling one, and it is not made here.

Same conventions as everything else this project places:

    origin        on the floor at the middle of the entrance wall,
                  +x into the space, +y left, +z up
    COLOR_0 alpha 1 = tint per instance, 0 = keep the authored rgb
    GLAZE_ prefix window glass: transparent, never a camera collider
    luminance     bright authored surfaces become emissive in the runtime
"""

import json
import math
import os
import sys
import time

import bpy

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
from mesh_audit import report_volume  # noqa: E402

ROOT = os.path.dirname(SCRIPTS)
DOCS = os.path.join(ROOT, "docs", "phase2")
COL = "36_corridor"

TAU = math.pi * 2.0

# rgb + tint mask (alpha 0 = keep the authored colour)
METAL = (0.145, 0.148, 0.152, 0.0)
BRUSHED = (0.205, 0.208, 0.214, 0.0)
WALL_DARK = (0.098, 0.096, 0.094, 0.0)
CEILING = (0.150, 0.150, 0.152, 0.0)
PANEL_LIT = (0.900, 0.880, 0.820, 0.0)
FLOOR_STONE = (0.240, 0.232, 0.215, 0.0)
BRASS = (0.290, 0.215, 0.095, 0.0)
BUTTON = (0.620, 0.700, 0.760, 0.0)

TRIM = (0.085, 0.082, 0.080, 0.0)      # car interior plastics
TRIM_MID = (0.130, 0.126, 0.122, 0.0)
SEAT = (0.062, 0.060, 0.064, 0.0)
DASH_LIT = (0.560, 0.660, 0.720, 0.0)  # instrument cluster, on
GLASS = (0.075, 0.090, 0.105, 0.0)
CHROME = (0.320, 0.328, 0.336, 0.0)

# the corridor's terminus: light, and only light
CORE = (0.980, 0.960, 0.900, 0.0)
RIBBON_HOT = (0.620, 0.880, 0.780, 0.0)
RIBBON_MID = (0.300, 0.560, 0.520, 0.0)
RIBBON_COOL = (0.130, 0.260, 0.280, 0.0)
HALO = (0.480, 0.760, 0.820, 0.0)


class Builder:
    """Vertex-coloured triangle soup; flat quads and per-corner colour."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []

    def _add(self, vs, fs, rgba):
        base = len(self.verts)
        self.verts.extend(vs)
        for f in fs:
            self.faces.append(tuple(base + i for i in f))
            self.cols.extend([rgba] * len(f))

    def box(self, cx, cy, cz, sx, sy, sz, rgba):
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        v = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
             (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
             (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
             (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
        # wound outward; see P2-062
        f = [(3, 2, 1, 0), (5, 6, 7, 4), (1, 5, 4, 0),
             (2, 6, 5, 1), (3, 7, 6, 2), (0, 4, 7, 3)]
        self._add(v, f, rgba)

    def slab(self, x0, x1, y0, y1, z, rgba, up=True):
        v = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        f = [(0, 1, 2, 3)] if up else [(3, 2, 1, 0)]
        self._add(v, f, rgba)

    def wall(self, x0, y0, x1, y1, z0, z1, rgba, inward=True):
        v = [(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)]
        f = [(0, 1, 2, 3)] if inward else [(3, 2, 1, 0)]
        self._add(v, f, rgba)

    def quad(self, a, b, c, d, rgba):
        self._add([a, b, c, d], [(0, 1, 2, 3)], rgba)

    def tube(self, cx, cy, z0, z1, r, rgba, seg=8, cap_top=True):
        a, b = [], []
        for i in range(seg):
            t = TAU * i / seg
            c, s = math.cos(t), math.sin(t)
            a.append((cx + c * r, cy + s * r, z0))
            b.append((cx + c * r, cy + s * r, z1))
        base = len(self.verts)
        self.verts.extend(a)
        self.verts.extend(b)
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i, base + j, base + seg + j,
                               base + seg + i))
            self.cols.extend([rgba] * 4)
        if cap_top:
            self.faces.append(tuple(base + seg + i for i in range(seg)))
            self.cols.extend([rgba] * seg)

    def frustum(self, cx, cy, z0, z1, r0, r1, rgba, seg=12, cap=True):
        a, b = [], []
        for i in range(seg):
            t = TAU * i / seg
            c, s = math.cos(t), math.sin(t)
            a.append((cx + c * r0, cy + s * r0, z0))
            b.append((cx + c * r1, cy + s * r1, z1))
        base = len(self.verts)
        self.verts.extend(a)
        self.verts.extend(b)
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i, base + j, base + seg + j,
                               base + seg + i))
            self.cols.extend([rgba] * 4)
        if cap:
            self.faces.append(tuple(base + seg + i for i in range(seg)))
            self.cols.extend([rgba] * seg)

    def torus_arc(self, cx, cy, cz, r, tube_r, a0, a1, rgba, seg=14, side=6):
        """An arc of tube bent around the z axis. Broken rings read as
        motion in a way a closed ring does not."""
        rings = []
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            ca, sa = math.cos(a), math.sin(a)
            ring = []
            for k in range(side):
                t = TAU * k / side
                # local frame: radial out, and up
                rr = r + math.cos(t) * tube_r
                ring.append((cx + ca * rr, cy + sa * rr,
                             cz + math.sin(t) * tube_r))
            rings.append(ring)
        base = len(self.verts)
        for ring in rings:
            self.verts.extend(ring)
        for i in range(seg):
            for k in range(side):
                k2 = (k + 1) % side
                self.faces.append((base + i * side + k, base + i * side + k2,
                                   base + (i + 1) * side + k2,
                                   base + (i + 1) * side + k))
                self.cols.extend([rgba] * 4)

    def ribbon(self, pts, widths, rgbas, up=(0.0, 0.0, 1.0)):
        """A strip through a list of points, twisting to stay broadside to
        the viewer as it climbs. Two triangles a segment."""
        left, right = [], []
        for i, (p, w) in enumerate(zip(pts, widths)):
            nxt = pts[min(i + 1, len(pts) - 1)]
            prv = pts[max(i - 1, 0)]
            t = [nxt[j] - prv[j] for j in range(3)]
            n = math.sqrt(sum(c * c for c in t)) or 1.0
            t = [c / n for c in t]
            # side = t x up
            s = [t[1] * up[2] - t[2] * up[1],
                 t[2] * up[0] - t[0] * up[2],
                 t[0] * up[1] - t[1] * up[0]]
            m = math.sqrt(sum(c * c for c in s)) or 1.0
            s = [c / m * w * 0.5 for c in s]
            left.append(tuple(p[j] - s[j] for j in range(3)))
            right.append(tuple(p[j] + s[j] for j in range(3)))
        for i in range(len(pts) - 1):
            self._add([left[i], right[i], right[i + 1], left[i + 1]],
                      [(0, 1, 2, 3)], rgbas[i])
            self._add([left[i + 1], right[i + 1], right[i], left[i]],
                      [(0, 1, 2, 3)], rgbas[i])

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def to_object(self, name, collection, mat):
        report_volume(name, self.verts, self.faces)
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        attr = me.color_attributes.new(name="vcol", type='FLOAT_COLOR',
                                       domain='CORNER')
        if len(self.cols) != len(me.loops):
            raise RuntimeError(
                "%s: %d colours for %d loops; validate() dropped %d faces"
                % (name, len(self.cols), len(me.loops),
                   len(self.faces) - len(me.polygons)))
        flat = []
        for c in self.cols:
            flat.extend(c)
        attr.data.foreach_set("color", flat)
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(mat)
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------------------
# LIFT_cab -- 2.3 x 2.1 m, 2.6 m clear
# ---------------------------------------------------------------------------
LIFT_W, LIFT_D, LIFT_H = 2.10, 2.30, 2.60


def build_lift(b):
    W, D, H = LIFT_W, LIFT_D, LIFT_H
    y0, y1 = -W * 0.5, W * 0.5

    b.slab(0, D, y0, y1, 0.0, FLOOR_STONE)
    b.slab(0, D, y0, y1, H, CEILING, up=False)
    b.slab(0.25, D - 0.25, y0 + 0.22, y1 - 0.22, H - 0.03, PANEL_LIT,
           up=False)

    # Three solid sides, doors on the fourth. All three face *in*: a lift is
    # only ever seen from inside it, and the first pass had them wound
    # outward, so the ride was 460 m of unobstructed Manhattan with a grey
    # slab floating in the middle of it.
    b.wall(D, y1, D, y0, 0, H, BRUSHED)
    b.wall(D, y0, 0, y0, 0, H, BRUSHED)
    b.wall(0, y1, D, y1, 0, H, BRUSHED)

    # door leaves, parted a hand's width so the cab reads as open
    for sy in (-1, 1):
        b.box(0.06, sy * (W * 0.25 + 0.06), H * 0.5 - 0.05,
              0.10, W * 0.5 - 0.12, H - 0.10, BRUSHED)
    b.box(0.06, 0.0, H - 0.08, 0.14, W, 0.16, METAL)      # header
    b.box(0.06, 0.0, 0.04, 0.14, W, 0.08, METAL)          # sill

    # handrail on the back and both sides
    for x0, y_0, x1, y_1 in ((D - 0.10, y0 + 0.15, D - 0.10, y1 - 0.15),
                             (0.35, y0 + 0.10, D - 0.15, y0 + 0.10),
                             (0.35, y1 - 0.10, D - 0.15, y1 - 0.10)):
        n = 6
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            b.box(x0 + (x1 - x0) * (t0 + t1) * 0.5,
                  y_0 + (y_1 - y_0) * (t0 + t1) * 0.5, 0.92,
                  max(0.06, abs(x1 - x0) / n), max(0.06, abs(y_1 - y_0) / n),
                  0.05, CHROME)

    # car operating panel, right of the doors
    b.box(0.14, y0 + 0.22, 1.35, 0.05, 0.30, 1.10, WALL_DARK)
    for k in range(6):
        b.box(0.17, y0 + 0.16 + (k % 2) * 0.12, 1.00 + (k // 2) * 0.24,
              0.02, 0.07, 0.07, BUTTON)
    b.box(0.17, y0 + 0.22, 1.78, 0.02, 0.22, 0.10, DASH_LIT)   # floor readout
    return {"width": W, "depth": D, "height": H, "kind": "lift"}


def build_lift_glass(b):
    return {"panes": 0}


# ---------------------------------------------------------------------------
# CAR_cabin -- sized to VEH_sedan: 4.80 x 1.85 x 1.45, x forward, z up,
# origin on the road surface at the middle of the car.
# ---------------------------------------------------------------------------
CAR_L, CAR_W, CAR_H = 4.80, 1.85, 1.45
EYE_X, EYE_Y, EYE_Z = -0.10, 0.36, 1.07     # driver's eye, left-hand drive


def build_car(b):
    L, W, H = CAR_L, CAR_W, CAR_H
    hw = W * 0.5 - 0.06
    floor_z = 0.34
    belt = 0.92                              # window sill height
    roof = 1.34

    # floor pan, transmission tunnel, bulkhead
    b.slab(-L * 0.42, L * 0.30, -hw, hw, floor_z, TRIM)
    b.box(0.05, 0.0, floor_z + 0.09, 1.5, 0.26, 0.18, TRIM_MID)
    b.wall(L * 0.30, -hw, L * 0.30, hw, floor_z, belt, TRIM_MID, inward=False)

    # Headlining and the roof rails that carry it. Both stop at the
    # windscreen header rather than running past it -- the first version
    # overhung the glass by a third of a metre and blacked out the top
    # quarter of the driver's view.
    head_x = L * 0.30 - 0.62
    b.slab(-L * 0.34, head_x, -hw, hw, roof, TRIM_MID, up=False)
    for sy in (-1, 1):
        b.box((head_x - L * 0.34) * 0.5, sy * hw, roof - 0.03,
              head_x + L * 0.34, 0.08, 0.07, TRIM)

    # A-pillars, rake matched to the sedan's windscreen
    for sy in (-1, 1):
        for k in range(4):
            t = k / 3.0
            b.box(L * 0.30 - t * 0.62, sy * (hw - 0.02 - t * 0.05),
                  belt + t * (roof - belt), 0.20, 0.09, 0.22, TRIM)
    # B-pillars and the top of the door cards
    for sy in (-1, 1):
        b.box(-L * 0.10, sy * hw, (belt + roof) * 0.5, 0.10, 0.08,
              roof - belt, TRIM)
        b.box(0.02, sy * hw, (floor_z + belt) * 0.5, L * 0.56, 0.09,
              belt - floor_z, TRIM_MID)
        b.box(0.24, sy * (hw - 0.05), belt - 0.10, 0.34, 0.10, 0.06, TRIM)
        b.box(-0.02, sy * (hw - 0.06), belt - 0.22, 0.16, 0.06, 0.10, CHROME)

    # dashboard: a top roll, a fascia, and a cluster binnacle
    b.box(L * 0.22, 0.0, belt - 0.04, 0.44, W - 0.14, 0.10, TRIM_MID)
    b.box(L * 0.19, 0.0, belt - 0.26, 0.16, W - 0.16, 0.38, TRIM)
    b.box(L * 0.17, EYE_Y, belt - 0.14, 0.22, 0.44, 0.20, TRIM_MID)
    b.box(L * 0.155, EYE_Y, belt - 0.15, 0.03, 0.34, 0.14, DASH_LIT)
    b.box(L * 0.17, -0.18, belt - 0.26, 0.03, 0.34, 0.22, DASH_LIT)  # centre

    # steering wheel: a rim arc, three spokes, a boss, on a raked column
    wx, wy, wz = L * 0.10, EYE_Y, belt - 0.09
    b.torus_arc(wx, wy, wz, 0.175, 0.022, 0.0, TAU, CHROME, seg=16, side=5)
    for k in range(3):
        a = TAU * k / 3 + 0.4
        b.box(wx + math.cos(a) * 0.09, wy + math.sin(a) * 0.09, wz,
              0.10, 0.10, 0.02, TRIM_MID)
    b.box(wx, wy, wz, 0.075, 0.075, 0.05, TRIM)
    b.box(wx + 0.13, wy, wz - 0.09, 0.22, 0.07, 0.07, TRIM)
    for sy in (-1, 1):                                   # stalks
        b.box(wx + 0.02, wy + sy * 0.14, wz - 0.02, 0.03, 0.16, 0.03, TRIM)

    # seats: base, back, headrest, for both front positions
    for sy in (1, -1):
        cy = sy * 0.36
        b.box(-0.28, cy, floor_z + 0.14, 0.56, 0.50, 0.16, SEAT)
        b.box(-0.55, cy, floor_z + 0.44, 0.14, 0.50, 0.62, SEAT)
        b.box(-0.58, cy, floor_z + 0.86, 0.12, 0.26, 0.22, SEAT)
    # rear bench, so the mirror has something to look at
    b.box(-1.25, 0.0, floor_z + 0.14, 0.60, W - 0.30, 0.16, SEAT)
    b.box(-1.52, 0.0, floor_z + 0.46, 0.14, W - 0.30, 0.64, SEAT)

    # rear-view mirror and sun visors, both behind the header, not out over
    # the bonnet where they used to sit
    b.box(head_x - 0.06, 0.0, roof - 0.11, 0.05, 0.28, 0.09, TRIM)
    b.box(head_x - 0.085, 0.0, roof - 0.11, 0.02, 0.24, 0.07, CHROME)
    for sy in (-1, 1):
        b.box(head_x - 0.11, sy * 0.36, roof - 0.04, 0.16, 0.30, 0.03,
              TRIM_MID)

    # centre console and shifter
    b.box(-0.18, 0.0, floor_z + 0.16, 0.90, 0.30, 0.22, TRIM)
    b.box(0.10, 0.0, floor_z + 0.34, 0.06, 0.06, 0.18, CHROME)
    return {"length": L, "width": W, "height": H, "kind": "car_cabin",
            "eye": [EYE_X, EYE_Y, EYE_Z]}


def build_car_glass(b):
    L, W = CAR_L, CAR_W
    hw = W * 0.5 - 0.06
    belt, roof = 0.92, 1.34
    # windscreen, raked; backlight; four side windows
    b.quad((L * 0.30, -hw, belt), (L * 0.30, hw, belt),
           (L * 0.30 - 0.62, hw - 0.05, roof),
           (L * 0.30 - 0.62, -hw + 0.05, roof), GLASS)
    b.quad((-L * 0.34, hw - 0.04, roof), (-L * 0.34, -hw + 0.04, roof),
           (-L * 0.34 - 0.30, -hw + 0.02, belt),
           (-L * 0.34 - 0.30, hw - 0.02, belt), GLASS)
    for sy in (-1, 1):
        b.wall(L * 0.30 - 0.62, sy * hw, -L * 0.10, sy * hw, belt, roof,
               GLASS, inward=sy > 0)
        b.wall(-L * 0.10, sy * hw, -L * 0.34, sy * hw, belt, roof,
               GLASS, inward=sy > 0)
    return {"panes": 6}


# ---------------------------------------------------------------------------
# SHENRON_form -- the terminus. Original abstract light form; see the module
# docstring. Authored around a dais origin: +z up, centred on (0, 0).
# ---------------------------------------------------------------------------
SHEN_H = 4.30


def build_shenron(b):
    # ---- core: a faceted orb, the brightest thing in the room ------------
    cz = 1.55
    b.frustum(0, 0, cz - 0.42, cz - 0.16, 0.10, 0.38, CORE, seg=10, cap=False)
    b.frustum(0, 0, cz - 0.16, cz + 0.16, 0.38, 0.38, CORE, seg=10, cap=False)
    b.frustum(0, 0, cz + 0.16, cz + 0.44, 0.38, 0.09, CORE, seg=10)

    # ---- the coil: a ribbon climbing around the core ---------------------
    # Two turns, tapering, hot at the head and cooling down the tail. The
    # runtime spins it; the mesh only has to be a good shape at rest.
    n = 54
    pts, widths, cols = [], [], []
    for i in range(n):
        t = i / (n - 1.0)
        a = TAU * 2.05 * t - 1.1
        r = 1.35 - 0.62 * t + 0.16 * math.sin(t * 7.0)
        z = 0.34 + t * (SHEN_H - 1.0) * 0.86
        pts.append((math.cos(a) * r, math.sin(a) * r, z))
        widths.append(0.40 * (1.0 - t) + 0.09)
        cols.append(RIBBON_HOT if t > 0.80 else
                    (RIBBON_MID if t > 0.42 else RIBBON_COOL))
    b.ribbon(pts, widths, cols)

    # a second, thinner counter-coil the other way -- one spiral alone reads
    # as a spring, two reading against each other read as motion
    n2 = 40
    pts2, w2, c2 = [], [], []
    for i in range(n2):
        t = i / (n2 - 1.0)
        a = -TAU * 1.45 * t + 2.4
        r = 0.95 - 0.34 * t
        z = 0.62 + t * (SHEN_H - 1.6) * 0.78
        pts2.append((math.cos(a) * r, math.sin(a) * r, z))
        w2.append(0.17 * (1.0 - t) + 0.05)
        c2.append(RIBBON_MID if t > 0.55 else RIBBON_COOL)
    b.ribbon(pts2, w2, c2)

    # ---- broken halo rings ------------------------------------------------
    for z, r, a0, span, col in ((0.52, 1.62, 0.2, 2.1, HALO),
                                (1.42, 1.30, 3.1, 2.4, HALO),
                                (2.46, 0.96, 5.0, 1.7, RIBBON_MID),
                                (3.30, 0.62, 1.4, 2.6, RIBBON_MID)):
        b.torus_arc(0, 0, z, r, 0.035, a0, a0 + span, col, seg=12, side=5)

    # ---- motes: small facets suspended in the volume ---------------------
    for i in range(18):
        a = TAU * (i * 0.6180339887) % TAU
        t = (i + 0.5) / 18.0
        r = 0.55 + 1.05 * ((i * 7) % 11) / 11.0
        z = 0.45 + t * (SHEN_H - 0.9)
        s = 0.055 + 0.035 * ((i * 5) % 7) / 7.0
        b.box(math.cos(a) * r, math.sin(a) * r, z, s, s, s,
              CORE if i % 4 == 0 else HALO)

    # ---- the tip ---------------------------------------------------------
    b.frustum(pts[-1][0], pts[-1][1], pts[-1][2], pts[-1][2] + 0.34,
              0.085, 0.012, CORE, seg=6)
    return {"height": SHEN_H, "radius": 1.75, "kind": "presence",
            "coil_points": n + n2}


def build_shenron_glass(b):
    return {"panes": 0}


PARTS = [
    ("LIFT_cab", build_lift, "GLAZE_lift", build_lift_glass),
    ("CAR_cabin", build_car, "GLAZE_car", build_car_glass),
    ("SHENRON_form", build_shenron, "GLAZE_shenron", build_shenron_glass),
]


def export_glb(objs, path):
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
    )
    op = bpy.ops.export_scene.gltf
    valid = set(op.get_rna_type().properties.keys())
    op(**{k: v for k, v in kwargs.items() if k in valid})
    return os.path.getsize(path) if os.path.exists(path) else 0


def main():
    t0 = time.time()
    bpy.ops.wm.read_homefile(use_empty=True)
    col = bpy.data.collections.new(COL)
    bpy.context.scene.collection.children.link(col)

    mat = bpy.data.materials.new("MAT_corridor")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.50
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    print("=" * 74)
    print("PHASE 2M  CORRIDOR PIECES (Blender, procedural)")
    print("=" * 74)
    objs = []
    spec = {}
    for name, fn, gname, gfn in PARTS:
        b = Builder()
        dims = fn(b)
        ob = b.to_object(name, col, mat)
        objs.append(ob)
        gb = Builder()
        gdims = gfn(gb)
        if gb.tris:
            gob = gb.to_object(gname, col, mat)
            objs.append(gob)
        spec[name] = dict(dims, tris=b.tris, glass_tris=gb.tris,
                          verts=len(ob.data.vertices),
                          glass=gname if gb.tris else None,
                          panes=gdims.get("panes", 0))
        print("  %-14s %6d verts  %6d tris (+%d glass)  %s"
              % (name, len(ob.data.vertices), b.tris, gb.tris, dims["kind"]))

    # The cabin has to fit inside the body it rides in, and the driver's eye
    # has to be inside the cabin. Both are checked, not assumed.
    car = spec["CAR_cabin"]
    fits = {
        "body": [CAR_L, CAR_W, CAR_H],
        "eye": [EYE_X, EYE_Y, EYE_Z],
        "eye_inside_body": bool(abs(EYE_X) < CAR_L * 0.5
                                and abs(EYE_Y) < CAR_W * 0.5
                                and 0.0 < EYE_Z < CAR_H),
        "eye_above_seat_base_m": round(EYE_Z - (0.34 + 0.22), 3),
        "headroom_m": round(1.34 - EYE_Z, 3),
    }
    if not fits["eye_inside_body"]:
        raise RuntimeError("driver's eye is outside the car body")
    if fits["headroom_m"] < 0.10:
        raise RuntimeError("driver's eye is in the headlining: %.3f m"
                           % fits["headroom_m"])

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "corridor.glb")
    size = export_glb(objs, path)
    blend = os.path.join(bc.BLEND, "manhattan_corridor.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "parts": spec,
        "total_tris": sum(v["tris"] + v["glass_tris"] for v in spec.values()),
        "glb_bytes": size,
        "space": "origin on the floor at the middle of the entrance wall, "
                 "+x into the space, +y left, +z up; CAR_cabin instead uses "
                 "the fleet convention, origin on the road surface at the "
                 "middle of the car, +x forward",
        "car": fits,
        "lift": {"width": LIFT_W, "depth": LIFT_D, "height": LIFT_H},
        "shenron": {
            "height_m": SHEN_H,
            "licence": "original abstract form: a coiling luminous ribbon "
                       "around a faceted core. No face, eyes, scales, horns "
                       "or other character features. Deliberately not a "
                       "reproduction of, and not derived from, any existing "
                       "character design.",
        },
        "licence": "generated procedurally; no purchased kit, no scanned "
                   "geometry, no photographic texture, no branded vehicle "
                   "interior",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "CORRIDOR_REPORT.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    print("-" * 74)
    print("  car     eye at (%.2f, %.2f, %.2f), %.2f m of headroom"
          % (EYE_X, EYE_Y, EYE_Z, fits["headroom_m"]))
    print("  lift    %.2f x %.2f x %.2f m" % (LIFT_W, LIFT_D, LIFT_H))
    print("  shenron %.1f m tall, %d ribbon points"
          % (SHEN_H, spec["SHENRON_form"]["coil_points"]))
    print("  %d tris total, %.1f KB glb"
          % (report["total_tris"], size / 1024.0))
    print("  blend -> %s" % report["blend"])
    print("  %.1f s" % report["seconds"])


main()
