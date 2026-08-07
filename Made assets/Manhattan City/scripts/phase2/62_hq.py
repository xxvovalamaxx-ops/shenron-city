"""
62_hq.py -- Phase 2L: the HQ tower and Floor 45, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/62_hq.py

The hero corridor the Phase 2 brief asks for ends at the HQ, then at Floor 45,
then at Shenron / Mission Control. Everything up to the market exists; this is
the last authored content the corridor needs.

    HQ_tower      the building itself -- plaza, podium, two shafts, the
                  double-height Floor 45 band expressed on the facade, and a
                  crown. Original design. It is not a copy of any real
                  corporate headquarters, carries no company's mark, and is
                  clad in authored vertex colour rather than photographed
                  facade.
    INT_floor45   Mission Control: a 32 x 24 m operations floor, 7 m clear,
                  glazed on two sides at 184.5 m so the city is the view.
    SHENRON_dais  the plinth the corridor terminates on.

Every one of the 58 tower floors is a real dimension rather than a look:
ground floor 8.2 m, typical 4.10 m, so floor 45 sits at

    8.2 + 43 * 4.10 = 184.5 m

and the interior is placed at exactly that height by the runtime, inside a
shaft that is measurably wide enough to hold it. The band is expressed on the
outside of the building, so from the street you can see where you are going.

A deliberate omission: the Mission Control screens are authored **dark**. The
brief forbids fabricating Mission Control state while offline, and a video
wall with invented telemetry baked into its vertex colours would be exactly
that -- a screenshot of a system reporting numbers no system produced. They
are powered-down panels until something real drives them.

Authored in the same local space every placed object in this project uses:
origin on the ground at the middle of the street frontage, +x into the site,
+y left along the frontage, +z up. The runtime drops that origin on a real
Manhattan lot and reads the anchor offsets out of docs/phase2/HQ_REPORT.json
rather than hard-coding them.

Conventions the runtime depends on:

    COLOR_0 alpha   1 = tint per instance, 0 = keep the authored rgb
    GLAZE_ prefix   window glass: rendered transparent, never a camera collider
    luminance       bright authored surfaces become emissive in the runtime,
                    which is how a room gets lit without a dozen real lights
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
COL = "35_hq"

TAU = math.pi * 2.0

# ---------------------------------------------------------------------------
# the building's own dimensions -- every one of these is used, not decorative
# ---------------------------------------------------------------------------
LOT_W = 54.0          # frontage, across y
PLAZA_D = 9.0         # open plaza between the kerb and the podium
PODIUM_D = 37.0       # podium depth, from x = PLAZA_D
PODIUM_H = 23.0
SHAFT1 = dict(x0=13.0, x1=43.0, y=19.0, z0=23.0, z1=152.0)
SHAFT2 = dict(x0=15.0, x1=41.0, y=16.5, z0=152.0, z1=208.0)
CROWN_Z = 226.0
MAST_Z = 244.0

GROUND_FLOOR = 8.2
TYP_FLOOR = 4.10
FLOOR45 = 45
FLOOR45_Z = GROUND_FLOOR + (FLOOR45 - 2) * TYP_FLOOR   # 184.5 m
BAND_H = TYP_FLOOR * 2.0                               # double-height band

# Floor 45's room, inside SHAFT2 with clearance on every side.
ROOM_W = 32.0
ROOM_D = 24.0
ROOM_H = 7.0
ROOM_X = SHAFT2["x0"] + 0.5

# rgb + tint mask (alpha 0 = keep the authored colour)
STONE_PALE = (0.270, 0.262, 0.246, 0.0)
STONE_DARK = (0.118, 0.116, 0.112, 0.0)
PIER = (0.205, 0.203, 0.198, 0.0)
SPANDREL = (0.088, 0.092, 0.098, 0.0)
FIN = (0.235, 0.240, 0.246, 0.0)
CURTAIN = (0.052, 0.078, 0.098, 0.0)
BAND_GLASS = (0.075, 0.115, 0.140, 0.0)
METAL = (0.145, 0.148, 0.152, 0.0)
STEEL_COLD = (0.190, 0.205, 0.215, 0.0)
PAVING = (0.215, 0.212, 0.204, 0.0)
PAVING_ALT = (0.178, 0.176, 0.170, 0.0)
GREEN = (0.045, 0.105, 0.038, 0.0)
BEACON = (0.980, 0.420, 0.300, 0.0)
PANEL_LIT = (0.900, 0.880, 0.820, 0.0)
STRIP_LIT = (0.860, 0.890, 0.940, 0.0)
CANOPY_LIT = (0.780, 0.760, 0.700, 0.0)

CARPET = (0.062, 0.064, 0.072, 0.0)
CARPET_ALT = (0.086, 0.090, 0.100, 0.0)
DESK = (0.130, 0.132, 0.138, 0.0)
DESK_TOP = (0.175, 0.178, 0.186, 0.0)
CHAIR = (0.048, 0.050, 0.056, 0.0)
SCREEN_OFF = (0.026, 0.028, 0.034, 0.0)   # a monitor that is not on
RACK = (0.070, 0.072, 0.078, 0.0)
WALL_DARK = (0.098, 0.096, 0.094, 0.0)
CEILING_DARK = (0.115, 0.116, 0.120, 0.0)
DAIS = (0.155, 0.150, 0.142, 0.0)
DAIS_RING = (0.560, 0.760, 0.880, 0.0)    # the one thing in the room that
GLASS = (0.075, 0.090, 0.105, 0.0)        # actually glows


class Builder:
    """Vertex-coloured triangle soup. Deliberately not bmesh: every surface
    here is a flat quad and the colours are per-corner, so a plain vertex and
    face list is both smaller and easier to reason about."""

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
        # Wound outward. The first version was inside-out -- signed volume
        # -8 for a 2 m cube -- so backface culling dropped every near face
        # and left you looking at the inside of the far one. On a convex,
        # flat-shaded box that is nearly invisible, which is how it survived
        # five scripts; what gave it away is that a backface is not a raycast
        # hit, so the walk collider let the player through the HQ podium.
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
        """A tapered ring -- the crown, and the dais."""
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

    def ring(self, x0, x1, y0, y1, z, t, rgba):
        """A flat rectangular ring of thickness t, lying at height z. Four
        slabs, because a spandrel band's inner face is never visible and
        paying six faces a floor for fifty-eight floors is 2,700 triangles of
        nothing."""
        self.slab(x0, x1, y0 - t, y0, z, rgba)
        self.slab(x0, x1, y1, y1 + t, z, rgba)
        self.slab(x0 - t, x0, y0 - t, y1 + t, z, rgba)
        self.slab(x1, x1 + t, y0 - t, y1 + t, z, rgba)

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
        # validate() silently removes duplicate and degenerate faces, which
        # leaves a per-loop colour array of the wrong length and an unhelpful
        # "internal error setting the array" three scripts downstream.
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
# HQ_tower
# ---------------------------------------------------------------------------
def curtain_wall(b, x0, x1, y0, y1, z0, z1, inset=0.42, fin_every=6):
    """A shaft: recessed glass, a spandrel band at every floor line, vertical
    fins, and a solid pier at each corner. Floor lines are the real ones, so
    counting bands up the facade from the street gets you to floor 45."""
    floors = 0
    z = z0
    while z + TYP_FLOOR <= z1 + 0.01:
        # skip the floor-45 band, which is built separately and taller
        if not (FLOOR45_Z - 0.01 <= z < FLOOR45_Z + BAND_H - 0.01):
            b.ring(x0, x1, y0, y1, z + TYP_FLOOR - 0.55, 0.22, SPANDREL)
            b.ring(x0, x1, y0, y1, z + TYP_FLOOR - 0.05, 0.22, FIN)
            floors += 1
        z += TYP_FLOOR

    # the glass itself, one recessed plane per face
    b.wall(x0 + inset, y0 + inset, x0 + inset, y1 - inset, z0, z1,
           CURTAIN, inward=False)
    b.wall(x1 - inset, y0 + inset, x1 - inset, y1 - inset, z0, z1,
           CURTAIN, inward=True)
    b.wall(x0 + inset, y0 + inset, x1 - inset, y0 + inset, z0, z1,
           CURTAIN, inward=True)
    b.wall(x0 + inset, y1 - inset, x1 - inset, y1 - inset, z0, z1,
           CURTAIN, inward=False)

    # vertical fins, and a wider pier on each corner
    zc, zh = (z0 + z1) * 0.5, z1 - z0
    n = max(2, int((y1 - y0) / fin_every))
    for i in range(1, n):
        y = y0 + (y1 - y0) * i / n
        b.box(x0 - 0.06, y, zc, 0.34, 0.30, zh, FIN)
        b.box(x1 + 0.06, y, zc, 0.34, 0.30, zh, FIN)
    m = max(2, int((x1 - x0) / fin_every))
    for i in range(1, m):
        x = x0 + (x1 - x0) * i / m
        b.box(x, y0 - 0.06, zc, 0.30, 0.34, zh, FIN)
        b.box(x, y1 + 0.06, zc, 0.30, 0.34, zh, FIN)
    for cx in (x0 + 0.55, x1 - 0.55):
        for cy in (y0 + 0.55, y1 - 0.55):
            b.box(cx, cy, zc, 1.30, 1.30, zh, PIER)
    return floors


def build_tower(b):
    hy = LOT_W * 0.5
    px0, px1 = PLAZA_D, PLAZA_D + PODIUM_D

    # ---- plaza -----------------------------------------------------------
    # Three shallow steps up off the pavement. Manhattan plazas are raised
    # because the lobby floor is above the flood line, not for the look.
    for i, z in enumerate((0.0, 0.30, 0.60)):
        b.slab(0.4 + i * 1.1, px0, -hy + i * 0.8, hy - i * 0.8, z,
               PAVING if i % 2 == 0 else PAVING_ALT)
        b.wall(0.4 + i * 1.1, -hy + i * 0.8, 0.4 + i * 1.1, hy - i * 0.8,
               z - 0.30, z, STONE_DARK, inward=False)
    for k in range(-4, 5):
        b.tube(1.6, k * 5.4, 0.0, 0.95, 0.13, METAL, seg=6)     # bollards
    for sy in (-1, 1):
        cy = sy * (hy - 5.0)
        b.box(px0 - 2.6, cy, 0.90, 2.2, 5.0, 0.60, STONE_PALE)  # planters
        b.tube(px0 - 2.6, cy, 1.20, 3.60, 0.95, GREEN, seg=8)

    # ---- podium ----------------------------------------------------------
    b.box((px0 + px1) * 0.5, 0.0, PODIUM_H * 0.5, PODIUM_D, LOT_W,
          PODIUM_H, STONE_PALE)
    # Entrance recess: a 20 x 7.2 m opening with real jambs and a head. The
    # first version was one solid block, which read fine from the plaza and
    # was a wall two metres in front of the lobby's glass from the inside.
    for sy in (-1, 1):
        b.box(px0 + 1.4, sy * 10.6, 3.6, 2.8, 1.2, 7.2, STONE_DARK)
    b.box(px0 + 1.4, 0.0, 7.5, 2.8, 22.4, 1.2, STONE_DARK)
    b.slab(px0, px0 + 2.8, -10.0, 10.0, 0.62, PAVING)
    for k in range(-4, 5):
        b.box(px0 - 0.05, k * 2.5, 3.6, 0.40, 0.24, 7.2, METAL)
    b.box(px0 - 0.05, 0.0, 7.35, 0.44, 20.0, 0.50, METAL)
    # cantilevered canopy over the doors, lit from underneath
    b.box(px0 * 0.55, 0.0, 7.9, PLAZA_D * 1.1, 22.0, 0.55, STONE_PALE)
    b.slab(0.6, px0 + 0.4, -11.0, 11.0, 7.60, CANOPY_LIT, up=False)
    # podium cornice and a shadow reveal at the top
    b.box((px0 + px1) * 0.5, 0.0, PODIUM_H - 0.45, PODIUM_D + 1.4,
          LOT_W + 1.4, 0.90, STONE_DARK)
    for z in (10.6, 14.7, 18.8):
        b.ring(px0, px1, -hy, hy, z, 0.30, SPANDREL)
    # podium glazing on the frontage above the canopy
    b.wall(px0 - 0.30, -hy + 2.0, px0 - 0.30, hy - 2.0, 9.2, PODIUM_H - 1.6,
           CURTAIN, inward=False)

    # ---- shafts ----------------------------------------------------------
    f1 = curtain_wall(b, SHAFT1["x0"], SHAFT1["x1"], -SHAFT1["y"],
                      SHAFT1["y"], SHAFT1["z0"], SHAFT1["z1"])
    # setback roof between the two shafts
    b.slab(SHAFT1["x0"], SHAFT1["x1"], -SHAFT1["y"], SHAFT1["y"],
           SHAFT1["z1"] + 0.10, STONE_DARK)
    f2 = curtain_wall(b, SHAFT2["x0"], SHAFT2["x1"], -SHAFT2["y"],
                      SHAFT2["y"], SHAFT2["z0"], SHAFT2["z1"])

    # ---- the floor 45 band, expressed ------------------------------------
    # Double height, glass pulled forward flush with the fins instead of
    # recessed, and a deep shadow reveal top and bottom. From the pavement it
    # is the one band on the building you can pick out, which is the point.
    s = SHAFT2
    for z in (FLOOR45_Z - 0.35, FLOOR45_Z + BAND_H - 0.35):
        b.ring(s["x0"], s["x1"], -s["y"], s["y"], z, 0.85, STONE_DARK)
    b.wall(s["x0"] + 0.06, -s["y"] + 0.06, s["x0"] + 0.06, s["y"] - 0.06,
           FLOOR45_Z, FLOOR45_Z + BAND_H, BAND_GLASS, inward=False)
    b.wall(s["x1"] - 0.06, -s["y"] + 0.06, s["x1"] - 0.06, s["y"] - 0.06,
           FLOOR45_Z, FLOOR45_Z + BAND_H, BAND_GLASS, inward=True)
    b.wall(s["x0"] + 0.06, -s["y"] + 0.06, s["x1"] - 0.06, -s["y"] + 0.06,
           FLOOR45_Z, FLOOR45_Z + BAND_H, BAND_GLASS, inward=True)
    b.wall(s["x0"] + 0.06, s["y"] - 0.06, s["x1"] - 0.06, s["y"] - 0.06,
           FLOOR45_Z, FLOOR45_Z + BAND_H, BAND_GLASS, inward=False)

    # ---- crown -----------------------------------------------------------
    cx, cy = (s["x0"] + s["x1"]) * 0.5, 0.0
    b.slab(s["x0"], s["x1"], -s["y"], s["y"], s["z1"] + 0.10, STONE_DARK)
    b.frustum(cx, cy, s["z1"], CROWN_Z, 15.5, 8.5, PIER, seg=12, cap=False)
    b.frustum(cx, cy, CROWN_Z, CROWN_Z + 4.0, 8.5, 6.0, STRIP_LIT, seg=12)
    b.tube(cx, cy, CROWN_Z + 4.0, MAST_Z - 3.0, 1.0, METAL, seg=6)
    b.tube(cx, cy, MAST_Z - 3.0, MAST_Z, 0.55, BEACON, seg=6)
    # aviation obstruction lights, which every tower over 60 m actually has
    for z in (CROWN_Z - 26.0, CROWN_Z - 8.0):
        for ang in range(0, 360, 90):
            t = math.radians(ang)
            b.box(cx + math.cos(t) * 12.0, cy + math.sin(t) * 12.0, z,
                  0.5, 0.5, 0.5, BEACON)

    return {
        "width": LOT_W, "depth": PLAZA_D + PODIUM_D, "height": MAST_Z,
        "roof": CROWN_Z, "podium_h": PODIUM_H,
        "floors_shaft1": f1, "floors_shaft2": f2,
        "floor45_z": FLOOR45_Z, "band_h": BAND_H,
    }


def build_tower_glass(b):
    """The two shaft faces the camera can actually see through: the floor-45
    band. The rest of the curtain wall is opaque authored glass -- a tower
    you can see through from 700 m away reads as a wireframe, not a tower."""
    s = SHAFT2
    b.wall(s["x0"] + 0.02, -s["y"] + 0.10, s["x0"] + 0.02, s["y"] - 0.10,
           FLOOR45_Z + 0.4, FLOOR45_Z + BAND_H - 0.5, GLASS, inward=False)
    b.wall(s["x0"] + 0.10, s["y"] - 0.02, s["x1"] - 0.10, s["y"] - 0.02,
           FLOOR45_Z + 0.4, FLOOR45_Z + BAND_H - 0.5, GLASS, inward=False)
    return {"panes": 2}


# ---------------------------------------------------------------------------
# INT_floor45 -- Mission Control
# ---------------------------------------------------------------------------
def console(b, cx, cy, screens=2, rot=False):
    """One operator station: worktop, return, two dark monitors, a chair."""
    w, d = (0.90, 1.80) if rot else (1.80, 0.90)
    b.box(cx, cy, 0.72, w, d, 0.06, DESK_TOP)
    b.box(cx, cy, 0.36, w * 0.88, d * 0.70, 0.68, DESK)
    for i in range(screens):
        o = (i - (screens - 1) * 0.5) * 0.62
        sx, sy = (0.06, 0.56) if rot else (0.56, 0.06)
        px, py = (cx + 0.30, cy + o) if rot else (cx + o, cy + 0.30)
        b.box(px, py, 1.06, sx, sy, 0.40, SCREEN_OFF)
        b.box(px, py, 0.80, 0.10, 0.10, 0.16, METAL)
    ox, oy = (cx - 0.75, cy) if rot else (cx, cy - 0.75)
    b.box(ox, oy, 0.24, 0.56, 0.56, 0.10, CHAIR)
    b.tube(ox, oy, 0.06, 0.24, 0.06, METAL, seg=6)
    b.box(ox - (0.24 if rot else 0.0), oy - (0.0 if rot else 0.24),
          0.52, 0.10 if rot else 0.56, 0.56 if rot else 0.10, 0.56, CHAIR)


def build_floor45(b):
    W, D, H = ROOM_W, ROOM_D, ROOM_H
    y0, y1 = -W * 0.5, W * 0.5

    # raised access floor, in two tones so the tiers read
    b.slab(0, D, y0, y1, 0.0, CARPET)
    b.slab(0.6, D - 0.6, y0 + 0.6, y1 - 0.6, 0.02, CARPET_ALT)
    b.slab(0, D, y0, y1, H, CEILING_DARK, up=False)

    # ---- shell -----------------------------------------------------------
    # front (x=0) and left (y=y1) are glass; back and right are solid. The
    # solid walls are wound *in* -- from inside the room their front faces
    # face the player, so backface culling does not throw them away and the
    # culled-from-inside check answers every direction (P2-067; the lift cab
    # in 64_corridor.py follows the same rule).
    b.wall(D, y1, D, y0, 0, H, WALL_DARK, inward=True)
    b.wall(D, y0, 0, y0, 0, H, WALL_DARK, inward=True)
    for x in (0.06,):                      # front mullions
        for k in range(-7, 8):
            b.box(x, k * 2.2, H * 0.5, 0.20, 0.14, H, METAL)
    for k in range(-5, 6):                 # left mullions
        b.box(D * 0.5 + k * 2.2, y1 - 0.06, H * 0.5, 0.14, 0.20, H, METAL)
    b.box(0.10, 0.0, H - 0.30, 0.28, W, 0.60, METAL)
    b.box(D * 0.5, y1 - 0.10, H - 0.30, D, 0.28, 0.60, METAL)

    # ---- ceiling: exposed structure, trays, and light strips -------------
    # Beams across, a cable tray beside each, and one light strip per bay.
    # Two crossing sets of strips turned the ceiling into scaffolding.
    for k in range(6):
        x = 2.0 + k * 3.6
        b.box(x, 0.0, H - 0.40, 0.28, W - 0.4, 0.80, CEILING_DARK)
        b.box(x + 0.9, 0.0, H - 1.15, 0.35, W - 2.0, 0.12, METAL)
        b.box(x - 0.9, 0.0, H - 1.00, 0.16, W - 6.0, 0.07, STRIP_LIT)

    # ---- the video wall --------------------------------------------------
    # Authored dark. The brief forbids fabricating Mission Control state
    # offline, and telemetry baked into a vertex colour is exactly that.
    b.box(D - 0.30, 0.0, 3.1, 0.30, 22.0, 5.0, WALL_DARK)
    for k in range(5):
        cy = (k - 2) * 4.2
        b.box(D - 0.52, cy, 3.30, 0.10, 3.90, 2.30, SCREEN_OFF)
        b.box(D - 0.56, cy, 3.30, 0.03, 3.74, 2.14, SCREEN_OFF)
    b.box(D - 0.52, 0.0, 5.05, 0.12, 22.0, 0.14, STRIP_LIT)

    # ---- tiered operations floor -----------------------------------------
    # Two rows, the back one raised 0.45 m, both facing the wall. This is why
    # a control room is a control room and not an office.
    b.box(D * 0.62, 0.0, 0.225, 6.4, W - 3.0, 0.45, CARPET_ALT)
    b.wall(D * 0.62 - 3.2, y0 + 1.5, D * 0.62 - 3.2, y1 - 1.5, 0.0, 0.45,
           METAL, inward=False)
    for k in range(6):
        console(b, D * 0.70, (k - 2.5) * 3.6, screens=2)
    for k in range(8):
        console(b, D * 0.40, (k - 3.5) * 3.1, screens=2)

    # ---- Shenron dais ----------------------------------------------------
    # The corridor terminates here. A raised circular plinth with a lit ring;
    # what stands on it is the runtime's business, not the mesh's.
    # The lit part is a ring around the edge, not the whole top. Capping the
    # tapered band with the ring colour made it a glowing white disc, which is
    # a light fitting lying on the floor, not a plinth.
    dx, dy = D * 0.20, 0.0
    b.frustum(dx, dy, 0.0, 0.34, 2.30, 2.08, DAIS, seg=16, cap=False)
    b.frustum(dx, dy, 0.34, 0.40, 2.08, 2.02, DAIS_RING, seg=16, cap=False)
    b.frustum(dx, dy, 0.40, 0.44, 2.02, 1.86, DAIS, seg=16)
    for i in range(8):
        t = TAU * i / 8
        b.box(dx + math.cos(t) * 2.6, dy + math.sin(t) * 2.6, 0.05,
              0.30, 0.30, 0.10, DAIS_RING)

    # ---- server racks behind glass, right wall ---------------------------
    for k in range(6):
        cy = y0 + 1.6 + k * 1.05
        b.box(D * 0.80, cy, 1.05, 1.0, 0.90, 2.10, RACK)
        b.box(D * 0.80 - 0.52, cy, 1.05, 0.04, 0.72, 1.86, SCREEN_OFF)

    # ---- briefing room, back left corner ---------------------------------
    # Its two glass walls live in GLAZE_floor45, not here: authored into the
    # shell they were opaque, and a glass meeting room that reads as a grey
    # box in the middle of the floor is worse than no meeting room.
    bx0, bx1 = D - 6.4, D - 0.6
    by0, by1 = y1 - 7.2, y1 - 0.6
    for cx in (bx0, bx1):                       # mullions at the corners
        b.box(cx, by0, 1.55, 0.12, 0.12, 3.10, METAL)
    b.box((bx0 + bx1) * 0.5, by0, 3.14, bx1 - bx0, 0.12, 0.12, METAL)
    b.box(bx0, (by0 + by1) * 0.5, 3.14, 0.12, by1 - by0, 0.12, METAL)
    b.box((bx0 + bx1) * 0.5, (by0 + by1) * 0.5, 3.14, bx1 - bx0,
          by1 - by0, 0.08, CEILING_DARK)
    b.box((bx0 + bx1) * 0.5, (by0 + by1) * 0.5, 3.05, 3.2, 3.2, 0.08,
          PANEL_LIT)
    b.box((bx0 + bx1) * 0.5, (by0 + by1) * 0.5, 0.72, 3.4, 1.5, 0.06,
          DESK_TOP)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((bx0 + bx1) * 0.5 + sx * 1.5,
                  (by0 + by1) * 0.5 + sy * 0.6, 0.36, 0.09, 0.09, 0.72,
                  METAL)
    for k in range(3):
        for sy in (-1, 1):
            b.box((bx0 + bx1) * 0.5 + (k - 1) * 1.1,
                  (by0 + by1) * 0.5 + sy * 1.25, 0.24, 0.52, 0.52, 0.08,
                  CHAIR)

    return {"width": W, "depth": D, "height": H, "kind": "mission_control",
            "consoles": 14, "screens_lit": 0}


def build_floor45_glass(b):
    W, D, H = ROOM_W, ROOM_D, ROOM_H
    b.wall(0.02, -W * 0.5, 0.02, W * 0.5, 0.30, H - 0.60, GLASS)
    b.wall(0.10, W * 0.5 - 0.02, D - 0.10, W * 0.5 - 0.02, 0.30, H - 0.60,
           GLASS)
    # the briefing room's two walls
    bx0, bx1 = D - 6.4, D - 0.6
    by0, by1 = W * 0.5 - 7.2, W * 0.5 - 0.6
    b.wall(bx0, by0, bx1, by0, 0.02, 3.08, GLASS)
    b.wall(bx0, by0, bx0, by1, 0.02, 3.08, GLASS)
    return {"panes": 4}


PARTS = [
    ("HQ_tower", build_tower, "GLAZE_hq", build_tower_glass),
    ("INT_floor45", build_floor45, "GLAZE_floor45", build_floor45_glass),
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

    mat = bpy.data.materials.new("MAT_hq")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.48
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    print("=" * 74)
    print("PHASE 2L  HQ TOWER + FLOOR 45 (Blender, procedural)")
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
        gob = gb.to_object(gname, col, mat)
        objs.append(gob)
        spec[name] = dict(dims, tris=b.tris, glass_tris=gb.tris,
                          verts=len(ob.data.vertices), glass=gname,
                          panes=gdims.get("panes", 0))
        print("  %-14s %5.1f x %5.1f x %6.1f m  %6d verts  %6d tris "
              "(+%d glass)"
              % (name, dims["width"], dims["depth"], dims["height"],
                 len(ob.data.vertices), b.tris, gb.tris))

    # Measured, not asserted: the interior has to actually fit inside the
    # shaft it is placed in, at the height it is placed at.
    s = SHAFT2
    clearance = {
        "shaft_depth_m": round(s["x1"] - s["x0"], 2),
        "shaft_width_m": round(s["y"] * 2.0, 2),
        "room_depth_m": ROOM_D,
        "room_width_m": ROOM_W,
        "depth_clear_m": round((s["x1"] - s["x0"]) - ROOM_D - 0.5, 2),
        "width_clear_m": round(s["y"] * 2.0 - ROOM_W, 2),
        "band_height_m": BAND_H,
        "room_height_m": ROOM_H,
        "head_clear_m": round(BAND_H - ROOM_H, 2),
        "floor45_inside_shaft2": bool(s["z0"] <= FLOOR45_Z
                                      and FLOOR45_Z + BAND_H <= s["z1"]),
    }
    for k in ("depth_clear_m", "width_clear_m", "head_clear_m"):
        if clearance[k] < 0:
            raise RuntimeError("floor 45 does not fit its shaft: %s = %.2f"
                               % (k, clearance[k]))
    if not clearance["floor45_inside_shaft2"]:
        raise RuntimeError("floor 45 band is not inside shaft 2")

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "hq.glb")
    size = export_glb(objs, path)
    blend = os.path.join(bc.BLEND, "manhattan_hq.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "parts": spec,
        "total_tris": sum(v["tris"] + v["glass_tris"] for v in spec.values()),
        "glb_bytes": size,
        "space": "origin on the ground at the middle of the street frontage, "
                 "+x into the site, +y left, +z up",
        "tower": {
            "lot_width_m": LOT_W, "lot_depth_m": PLAZA_D + PODIUM_D,
            "plaza_depth_m": PLAZA_D, "podium_height_m": PODIUM_H,
            "roof_m": CROWN_Z, "mast_m": MAST_Z,
            "ground_floor_m": GROUND_FLOOR, "typical_floor_m": TYP_FLOOR,
            "floors": spec["HQ_tower"]["floors_shaft1"]
            + spec["HQ_tower"]["floors_shaft2"],
        },
        # what the runtime needs to put the room inside the building
        "anchor": {
            "floor45": {
                "x": ROOM_X, "y": 0.0, "z": FLOOR45_Z,
                "floor": FLOOR45,
                "note": "tower-local; same yaw as the tower",
            },
            "lobby_door": {"x": PLAZA_D - 0.2, "y": 0.0, "z": 0.60},
            "dais": {"x": ROOM_D * 0.20, "y": 0.0, "z": 0.42,
                     "note": "floor45-local; the end of the hero corridor"},
        },
        "clearance": clearance,
        "mission_control": {
            "screens": 5, "consoles": 14, "screens_lit": 0,
            "note": "video wall and every monitor authored dark. Mission "
                    "Control state is not fabricated offline, and telemetry "
                    "baked into vertex colour would be exactly that.",
        },
        "licence": "original design, generated procedurally. Not a model of "
                   "any real corporate headquarters, carries no company "
                   "mark, and uses no photographed facade or purchased kit.",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "HQ_REPORT.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    print("-" * 74)
    print("  floor %d at %.1f m  (ground %.1f + %d x %.2f)"
          % (FLOOR45, FLOOR45_Z, GROUND_FLOOR, FLOOR45 - 2, TYP_FLOOR))
    print("  shaft 2 is %.1f x %.1f m; room is %.1f x %.1f m -> %.1f / %.1f m "
          "clear" % (clearance["shaft_depth_m"], clearance["shaft_width_m"],
                     ROOM_D, ROOM_W, clearance["depth_clear_m"],
                     clearance["width_clear_m"]))
    print("  %d tris total, %.1f KB glb, %d floors"
          % (report["total_tris"], size / 1024.0, report["tower"]["floors"]))
    print("  blend -> %s" % report["blend"])
    print("  %.1f s" % report["seconds"])


main()
