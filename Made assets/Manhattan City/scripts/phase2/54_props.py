"""
54_props.py -- Phase 2H: pedestrians and street furniture, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/54_props.py

Same licensing position as the fleet (docs/phase2/LICENSING.md): nothing here
is downloaded, ripped or traced. Every mesh is generated from primitives at
measured dimensions, so it can be shipped, modified and redistributed without
asking anyone.

Two exports, because they need two runtime materials:

    exports/props.glb   street furniture and trees, one object per type
    exports/peds.glb    three pedestrian bodies

Pedestrian colouring uses three per-instance channels rather than one, because
a crowd where everybody shares a shirt colour with their trousers and their
face reads as plastic. COLOR_0's alpha selects the channel:

    a = 1.00   top      -> instanceColor
    a = 0.66   bottom   -> aBottom attribute
    a = 0.33   skin     -> aSkin attribute
    a = 0.00   authored -> hair, shoes, bag keep their own rgb

Pedestrians also walk. There is no skeleton and no animation clip: each limb
carries its identity and its pivot height in UV0, and the vertex shader swings
it about that pivot by a per-instance phase.

    uv.x   0.0 static  0.2 leg L  0.4 leg R  0.6 arm L  0.8 arm R
    uv.y   pivot height in metres / 4.0

That costs four bytes a vertex and no animation data at all, which is what
makes a crowd of a few thousand affordable.
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
from mesh_audit import assert_outward  # noqa: E402

ROOT = os.path.dirname(SCRIPTS)
DOCS = os.path.join(ROOT, "docs", "phase2")

COL_PROPS = "31_streetfurniture"
COL_PEDS = "32_pedestrians"

TAU = math.pi * 2.0

# ---- pedestrian channel masks --------------------------------------------
TOP = 1.00
BOTTOM = 0.66
SKIN = 0.33
FIXED = 0.00

HAIR = (0.035, 0.026, 0.020)
HAIR_L = (0.130, 0.092, 0.048)
SHOE = (0.022, 0.020, 0.019)
BAG = (0.075, 0.062, 0.055)

# ---- furniture palette (linear, they are lit by the same sun) -------------
POLE = (0.048, 0.052, 0.048, 0.0)      # NYC's dull olive-grey pole finish
POLE_DK = (0.030, 0.033, 0.031, 0.0)
LENS = (0.620, 0.560, 0.400, 0.0)
SIGNAL_BOX = (0.028, 0.036, 0.030, 0.0)
LAMP_R = (0.380, 0.030, 0.022, 0.0)
LAMP_Y = (0.420, 0.300, 0.030, 0.0)
LAMP_G = (0.030, 0.300, 0.120, 0.0)
HYDRANT = (1.0, 1.0, 1.0, 1.0)         # tinted per instance
HYDRANT_CAP = (0.050, 0.050, 0.052, 0.0)
BIN_GREEN = (0.018, 0.052, 0.030, 0.0)
GLASS = (0.075, 0.090, 0.105, 0.0)
STEEL = (0.115, 0.118, 0.120, 0.0)
BENCH = (0.085, 0.070, 0.052, 0.0)
AD_PANEL = (0.180, 0.180, 0.190, 0.0)
BARK = (0.055, 0.046, 0.038, 0.0)
CANOPY = (1.0, 1.0, 1.0, 1.0)          # tinted per instance
SOIL = (0.026, 0.021, 0.016, 0.0)
NEWSPRINT = (0.170, 0.165, 0.150, 0.0)


class Builder:
    """Coloured primitives accumulated into one mesh, with a UV channel that
    carries limb identity for the pedestrians."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []       # rgba per loop
        self.uvs = []        # (u, v) per loop

    def _add(self, vs, fs, rgba, uv=(0.0, 0.0)):
        base = len(self.verts)
        self.verts.extend(vs)
        for f in fs:
            self.faces.append(tuple(base + i for i in f))
            self.cols.extend([rgba] * len(f))
            self.uvs.extend([uv] * len(f))

    def box(self, cx, cy, cz, sx, sy, sz, rgba, uv=(0.0, 0.0),
            taper_top=1.0):
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        tx, ty = hx * taper_top, hy * taper_top
        v = [
            (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
            (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
            (cx - tx, cy - ty, cz + hz), (cx + tx, cy - ty, cz + hz),
            (cx + tx, cy + ty, cz + hz), (cx - tx, cy + ty, cz + hz),
        ]
        # Wound outward. The first version was inside-out -- signed volume
        # -8 for a 2 m cube -- so backface culling dropped every near face
        # and left you looking at the inside of the far one. On a convex,
        # flat-shaded box that is nearly invisible, which is how it survived
        # five scripts; what gave it away is that a backface is not a raycast
        # hit, so the walk collider let the player through the HQ podium.
        f = [(3, 2, 1, 0), (5, 6, 7, 4), (1, 5, 4, 0),
             (2, 6, 5, 1), (3, 7, 6, 2), (0, 4, 7, 3)]
        self._add(v, f, rgba, uv)

    def limb(self, cx, cy, cz, sx, sy, sz, rgba, code, pivot_z):
        """A box that the vertex shader will swing about `pivot_z`."""
        self.box(cx, cy, cz, sx, sy, sz, rgba, uv=(code, pivot_z / 4.0))

    def tube(self, cx, cy, z0, z1, r0, r1, rgba, seg=8, uv=(0.0, 0.0),
             cap_top=True, cap_bottom=True):
        """Vertical tapered prism -- poles, trunks, bins, hydrant barrels."""
        ring_a, ring_b = [], []
        for i in range(seg):
            t = TAU * i / seg
            c, s = math.cos(t), math.sin(t)
            ring_a.append((cx + c * r0, cy + s * r0, z0))
            ring_b.append((cx + c * r1, cy + s * r1, z1))
        base = len(self.verts)
        self.verts.extend(ring_a)
        self.verts.extend(ring_b)
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i, base + j, base + seg + j,
                               base + seg + i))
            self.cols.extend([rgba] * 4)
            self.uvs.extend([uv] * 4)
        if cap_bottom:
            self.faces.append(tuple(base + i for i in range(seg - 1, -1, -1)))
            self.cols.extend([rgba] * seg)
            self.uvs.extend([uv] * seg)
        if cap_top:
            self.faces.append(tuple(base + seg + i for i in range(seg)))
            self.cols.extend([rgba] * seg)
            self.uvs.extend([uv] * seg)

    def cone(self, cx, cy, z0, z1, r, rgba, seg=8, uv=(0.0, 0.0)):
        ring = []
        for i in range(seg):
            t = TAU * i / seg
            ring.append((cx + math.cos(t) * r, cy + math.sin(t) * r, z0))
        base = len(self.verts)
        self.verts.extend(ring)
        self.verts.append((cx, cy, z1))
        tip = base + seg
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i, base + j, tip))
            self.cols.extend([rgba] * 3)
            self.uvs.extend([uv] * 3)
        self.faces.append(tuple(base + i for i in range(seg - 1, -1, -1)))
        self.cols.extend([rgba] * seg)
        self.uvs.extend([uv] * seg)

    def blob(self, cx, cy, cz, rx, rz, rgba, seg=8, rings=3, uv=(0.0, 0.0)):
        """A crude sphere for a tree canopy: `rings` latitude bands."""
        lat = []
        for k in range(rings + 1):
            a = math.pi * (k / rings) - math.pi * 0.5
            lat.append((math.cos(a) * rx, math.sin(a) * rz))
        base = len(self.verts)
        for k in range(rings + 1):
            r, dz = lat[k]
            if k == 0 or k == rings:
                self.verts.append((cx, cy, cz + dz))
            else:
                for i in range(seg):
                    t = TAU * i / seg
                    self.verts.append((cx + math.cos(t) * r,
                                       cy + math.sin(t) * r, cz + dz))
        # index helper
        def ix(k, i):
            if k == 0:
                return base
            if k == rings:
                return base + 1 + (rings - 1) * seg
            return base + 1 + (k - 1) * seg + (i % seg)

        for k in range(rings):
            for i in range(seg):
                a, b = ix(k, i), ix(k, i + 1)
                c, d = ix(k + 1, i + 1), ix(k + 1, i)
                if k == 0:
                    f = (a, c, d)
                elif k == rings - 1:
                    f = (a, b, c)
                else:
                    f = (a, b, c, d)
                self.faces.append(f)
                self.cols.extend([rgba] * len(f))
                self.uvs.extend([uv] * len(f))

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

        uv = me.uv_layers.new(name="limb")
        flat = []
        for u, v in self.uvs:
            flat.extend((u, v))
        uv.data.foreach_set("uv", flat)

        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------------------
# pedestrians. x forward, y across, z up, origin between the feet.
# ---------------------------------------------------------------------------
def build_person(b, h=1.75, coat=False, bag=False, hair=HAIR, wide=1.0):
    """One body. Proportions are canonical eight-head figure, trimmed to the
    real 7.5 that adults actually are."""
    head_h = h * 0.132
    eye = h
    hip = h * 0.525
    shoulder = h * 0.812
    neck = h * 0.855
    foot = h * 0.034
    bw = 0.36 * wide                      # shoulder width
    hipw = 0.30 * wide

    torso_top = TOP if not coat else TOP
    torso_z = (hip + shoulder) * 0.5
    b.box(0.0, 0.0, torso_z, 0.21 * wide, bw, shoulder - hip,
          (1, 1, 1, torso_top), taper_top=1.04)
    if coat:
        # a coat drops past the hip and reads instantly at a distance
        b.box(0.0, 0.0, hip - 0.06, 0.23 * wide, bw * 0.98, 0.30,
              (1, 1, 1, TOP))

    # legs swing about the hip
    for sy, code in ((-1, 0.2), (1, 0.4)):
        b.limb(0.0, sy * hipw * 0.28, (hip + foot) * 0.5,
               0.16 * wide, 0.145 * wide, hip - foot,
               (1, 1, 1, BOTTOM), code, hip)
        b.limb(0.03, sy * hipw * 0.28, foot * 0.5,
               0.25 * wide, 0.125 * wide, foot,
               (SHOE[0], SHOE[1], SHOE[2], FIXED), code, hip)

    # arms swing about the shoulder, out of phase with the legs
    for sy, code in ((-1, 0.8), (1, 0.6)):
        b.limb(0.0, sy * (bw * 0.5 + 0.055), (shoulder + hip) * 0.5 + 0.06,
               0.115 * wide, 0.105 * wide, shoulder - hip - 0.10,
               (1, 1, 1, TOP if coat else TOP), code, shoulder)
        b.limb(0.0, sy * (bw * 0.5 + 0.055), hip + 0.05,
               0.10 * wide, 0.095 * wide, 0.10,
               (1, 1, 1, SKIN), code, shoulder)          # hand

    b.box(0.0, 0.0, (shoulder + neck) * 0.5, 0.11, 0.13, neck - shoulder,
          (1, 1, 1, SKIN))                               # neck
    b.box(0.0, 0.0, neck + head_h * 0.5, 0.185, 0.155, head_h,
          (1, 1, 1, SKIN))                               # head
    b.box(-0.012, 0.0, neck + head_h * 0.80, 0.195, 0.165, head_h * 0.46,
          (hair[0], hair[1], hair[2], FIXED))            # hair

    if bag:
        b.box(-0.16, 0.0, shoulder - 0.30, 0.14, 0.26, 0.30,
              (BAG[0], BAG[1], BAG[2], FIXED))
        b.box(-0.09, 0.0, shoulder - 0.10, 0.03, 0.05, 0.32,
              (BAG[0], BAG[1], BAG[2], FIXED))           # strap
    return {"height": round(eye, 3), "hip": round(hip, 3),
            "shoulder": round(shoulder, 3)}


def ped_adult_a(b):
    return build_person(b, h=1.76, coat=False, bag=False, hair=HAIR)


def ped_adult_b(b):
    return build_person(b, h=1.68, coat=True, bag=True, hair=HAIR_L,
                        wide=0.95)


def ped_child(b):
    return build_person(b, h=1.24, coat=False, bag=True, hair=HAIR,
                        wide=0.88)


PEDS = [
    ("PED_adult_a", ped_adult_a),
    ("PED_adult_b", ped_adult_b),
    ("PED_child", ped_child),
]


# ---------------------------------------------------------------------------
# street furniture. +x points at the carriageway.
# ---------------------------------------------------------------------------
def prop_streetlight(b):
    b.tube(0.0, 0.0, 0.0, 0.55, 0.145, 0.115, POLE_DK)          # base casting
    b.tube(0.0, 0.0, 0.55, 8.60, 0.098, 0.062, POLE)            # shaft
    # the cobra head: a short rise then a horizontal arm over the kerb lane
    b.box(0.55, 0.0, 8.78, 1.30, 0.075, 0.075, POLE)
    b.box(1.95, 0.0, 8.90, 1.60, 0.070, 0.070, POLE)
    b.box(2.80, 0.0, 8.84, 0.62, 0.26, 0.13, POLE_DK, taper_top=0.75)
    b.box(2.80, 0.0, 8.755, 0.52, 0.21, 0.05, LENS)
    return {"height": 8.9, "reach": 3.1}


def prop_signal(b):
    b.tube(0.0, 0.0, 0.0, 0.42, 0.16, 0.135, POLE_DK)
    b.tube(0.0, 0.0, 0.42, 4.60, 0.105, 0.082, POLE)
    b.box(1.85, 0.0, 4.55, 3.70, 0.085, 0.085, POLE)            # mast arm
    # signal head, three lenses, hanging at the far end of the arm
    b.box(3.45, 0.0, 4.02, 0.30, 0.34, 0.95, SIGNAL_BOX)
    for k, lamp in enumerate((LAMP_R, LAMP_Y, LAMP_G)):
        b.box(3.30, 0.0, 4.36 - k * 0.29, 0.03, 0.20, 0.20, lamp)
    b.box(3.45, 0.0, 4.53, 0.36, 0.40, 0.10, SIGNAL_BOX)        # visor cap
    # pedestrian head on the pole, facing across the street
    b.box(0.0, 0.20, 2.95, 0.26, 0.10, 0.34, SIGNAL_BOX)
    b.box(0.0, 0.26, 2.95, 0.20, 0.02, 0.26, LAMP_Y)
    b.box(0.0, -0.17, 1.05, 0.13, 0.09, 0.16, SIGNAL_BOX)       # push button
    return {"height": 4.7, "reach": 3.7}


def prop_hydrant(b):
    b.tube(0.0, 0.0, 0.0, 0.10, 0.155, 0.145, HYDRANT_CAP)      # flange
    b.tube(0.0, 0.0, 0.10, 0.60, 0.115, 0.105, HYDRANT)         # barrel
    b.tube(0.0, 0.0, 0.60, 0.70, 0.135, 0.120, HYDRANT)         # bonnet skirt
    b.tube(0.0, 0.0, 0.70, 0.82, 0.098, 0.045, HYDRANT_CAP)     # bonnet
    b.box(0.0, 0.0, 0.86, 0.055, 0.11, 0.06, HYDRANT_CAP)       # operating nut
    for sy in (-1, 1):                                          # side nozzles
        b.box(0.0, sy * 0.135, 0.44, 0.10, 0.09, 0.10, HYDRANT_CAP)
    b.box(0.15, 0.0, 0.44, 0.09, 0.12, 0.12, HYDRANT_CAP)       # steamer
    return {"height": 0.9}


def prop_bin(b):
    b.tube(0.0, 0.0, 0.02, 0.86, 0.29, 0.315, BIN_GREEN, seg=10,
           cap_top=False)
    b.tube(0.0, 0.0, 0.86, 0.92, 0.325, 0.325, BIN_GREEN, seg=10,
           cap_top=False, cap_bottom=False)                     # rim
    b.tube(0.0, 0.0, 0.0, 0.03, 0.30, 0.30, POLE_DK, seg=10)    # foot ring
    return {"height": 0.92}


def prop_shelter(b, L=4.30, D=1.65, H=2.62):
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(sx * (L * 0.5 - 0.09), sy * (D * 0.5 - 0.07), H * 0.5,
                  0.08, 0.08, H, STEEL)
    b.box(0.0, 0.0, H + 0.055, L + 0.22, D + 0.30, 0.11, STEEL)  # roof slab
    b.box(0.0, -(D * 0.5 - 0.03), H * 0.5 + 0.10, L - 0.20, 0.03, H - 0.55,
          GLASS)                                                # back wall
    b.box(-(L * 0.5 - 0.05), 0.0, H * 0.5 + 0.10, 0.03, D - 0.25, H - 0.55,
          GLASS)                                                # one end
    b.box(L * 0.5 + 0.16, 0.0, H * 0.5, 0.09, D - 0.20, H - 0.20, AD_PANEL)
    b.box(0.0, -(D * 0.5 - 0.30), 0.46, L - 0.70, 0.38, 0.06, BENCH)
    for sx in (-1, 0, 1):
        b.box(sx * (L * 0.30), -(D * 0.5 - 0.30), 0.22, 0.06, 0.34, 0.44,
              STEEL)
    return {"length": L, "depth": D, "height": H}


def prop_bollard(b):
    b.tube(0.0, 0.0, 0.0, 0.92, 0.075, 0.070, POLE_DK, seg=8, cap_top=False)
    b.blob(0.0, 0.0, 0.92, 0.070, 0.055, POLE_DK, seg=8, rings=2)
    return {"height": 0.98}


def prop_newsbox(b):
    b.box(0.0, 0.0, 0.55, 0.42, 0.46, 0.86, POLE_DK)
    b.box(0.21, 0.0, 0.82, 0.02, 0.34, 0.26, NEWSPRINT)         # window
    b.box(0.0, 0.0, 1.00, 0.44, 0.48, 0.06, POLE_DK)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(sx * 0.16, sy * 0.18, 0.06, 0.05, 0.05, 0.12, POLE_DK)
    return {"height": 1.03}


# trees are authored at 8 m; the runtime scales by measured dbh
def prop_tree_broad(b):
    b.box(0.0, 0.0, 0.012, 1.35, 1.35, 0.024, SOIL)             # tree pit
    b.tube(0.0, 0.0, 0.0, 2.70, 0.185, 0.140, BARK, seg=6)
    # 8 segments over 3 rings read as a green box from the pavement, and this
    # is the prop the camera stands closest to more often than any other.
    for dx, dy, dz, r in ((0.0, 0.0, 5.05, 2.55), (0.85, 0.55, 4.15, 1.55),
                          (-0.75, -0.60, 4.35, 1.45)):
        b.blob(dx, dy, dz, r, r * 0.86, CANOPY, seg=10, rings=4)
    return {"height": 8.0}


def prop_tree_column(b):
    b.box(0.0, 0.0, 0.012, 1.20, 1.20, 0.024, SOIL)
    b.tube(0.0, 0.0, 0.0, 2.10, 0.160, 0.120, BARK, seg=6)
    b.blob(0.0, 0.0, 5.10, 1.35, 3.05, CANOPY, seg=10, rings=5)
    return {"height": 8.0}


def prop_tree_conifer(b):
    b.box(0.0, 0.0, 0.012, 1.20, 1.20, 0.024, SOIL)
    b.tube(0.0, 0.0, 0.0, 1.20, 0.170, 0.140, BARK, seg=6)
    b.cone(0.0, 0.0, 1.10, 4.30, 1.85, CANOPY, seg=8)
    b.cone(0.0, 0.0, 3.60, 6.30, 1.35, CANOPY, seg=8)
    b.cone(0.0, 0.0, 5.60, 8.00, 0.85, CANOPY, seg=8)
    return {"height": 8.0}


PROPS = [
    ("PROP_tree_broad", prop_tree_broad),
    ("PROP_tree_column", prop_tree_column),
    ("PROP_tree_conifer", prop_tree_conifer),
    ("PROP_streetlight", prop_streetlight),
    ("PROP_signal", prop_signal),
    ("PROP_hydrant", prop_hydrant),
    ("PROP_bin", prop_bin),
    ("PROP_shelter", prop_shelter),
    ("PROP_bollard", prop_bollard),
    ("PROP_newsbox", prop_newsbox),
]


def export_glb(objs, path):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kwargs = dict(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
        # UV0 carries the limb rig. Without this the pedestrians export as
        # statues and nothing in the runtime can tell a leg from a torso.
        export_texcoords=True,
        export_normals=True, export_materials='EXPORT',
        export_cameras=False, export_lights=False, export_animations=False,
        export_attributes=True,
        export_vertex_color='NAME', export_vertex_color_name='vcol',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        # No Draco: a few thousand triangles, and quantization is what buried
        # the road surface in P2-022.
    )
    op = bpy.ops.export_scene.gltf
    valid = set(op.get_rna_type().properties.keys())
    op(**{k: v for k, v in kwargs.items() if k in valid})
    return os.path.getsize(path) if os.path.exists(path) else 0


def make_material(name, rough):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def build(group, collection, mat):
    objs = []
    spec = {}
    for name, fn in group:
        b = Builder()
        dims = fn(b)
        ob = b.to_object(name, collection)
        ob.data.materials.append(mat)
        objs.append(ob)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        spec[name] = dict(dims, tris=tris, verts=len(ob.data.vertices))
        print("  %-20s %5d verts  %5d tris   %s"
              % (name, len(ob.data.vertices), tris,
                 " ".join("%s=%.2f" % kv for kv in dims.items())))
    return objs, spec


def main():
    t0 = time.time()
    bpy.ops.wm.read_homefile(use_empty=True)
    cp = bpy.data.collections.new(COL_PROPS)
    ce = bpy.data.collections.new(COL_PEDS)
    bpy.context.scene.collection.children.link(cp)
    bpy.context.scene.collection.children.link(ce)

    mat_prop = make_material("MAT_streetfurniture", 0.62)
    mat_ped = make_material("MAT_pedestrian", 0.78)

    print("=" * 74)
    print("PHASE 2H  STREET FURNITURE + PEDESTRIANS (Blender, procedural)")
    print("=" * 74)
    prop_objs, prop_spec = build(PROPS, cp, mat_prop)
    print("-" * 74)
    ped_objs, ped_spec = build(PEDS, ce, mat_ped)

    os.makedirs(bc.EXPORTS, exist_ok=True)
    p_props = os.path.join(bc.EXPORTS, "props.glb")
    p_peds = os.path.join(bc.EXPORTS, "peds.glb")
    s_props = export_glb(prop_objs, p_props)
    s_peds = export_glb(ped_objs, p_peds)

    blend = os.path.join(bc.BLEND, "manhattan_props.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "props": prop_spec,
        "peds": ped_spec,
        "prop_tris": sum(v["tris"] for v in prop_spec.values()),
        "ped_tris": sum(v["tris"] for v in ped_spec.values()),
        "props_glb_bytes": s_props,
        "peds_glb_bytes": s_peds,
        "ped_channels": {"1.00": "top -> instanceColor",
                         "0.66": "bottom -> aBottom",
                         "0.33": "skin -> aSkin",
                         "0.00": "authored rgb"},
        "limb_uv": {"u": "0.0 static, 0.2 legL, 0.4 legR, 0.6 armL, 0.8 armR",
                    "v": "pivot height in metres / 4"},
        "licence": "generated procedurally; no third-party asset",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "PROP_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  furniture       : %d types, %d triangles, %.1f KB"
          % (len(PROPS), report["prop_tris"], s_props / 1024.0))
    print("  pedestrians     : %d types, %d triangles, %.1f KB"
          % (len(PEDS), report["ped_tris"], s_peds / 1024.0))
    print("  saved           : %s  (%.0fs)"
          % (os.path.relpath(blend, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
