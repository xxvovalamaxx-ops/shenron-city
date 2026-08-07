"""
60_interiors.py -- Phase 2K: interiors, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/60_interiors.py

The hero corridor the Phase 2 brief asks for runs penthouse -> lobby -> car ->
streets -> market -> HQ -> floor 45. Three of those are rooms, and this builds
them. Same rules as everything else: generated from primitives, no purchased
kit, no scanned furniture, no photographic texture.

    INT_lobby       a tower lobby -- glazed street wall, reception desk,
                    lift bank, terrazzo floor, seating
    INT_penthouse   a top-floor apartment, glazed on two sides so the real
                    city is the view out of the window
    INT_bodega      a corner market -- aisles, chiller wall, counter

Authored in room-local space: origin on the floor at the middle of the
entrance wall, +x into the room, +y to the left, +z up. The runtime drops that
origin at a real building's door or roof height, so an interior is not a
separate scene -- it sits inside the city, and the windows look out at it.

Two conventions the runtime depends on:

    COLOR_0 alpha   1 = tint per instance, 0 = keep the authored rgb, the same
                    mask the fleet, props and weather use
    GLAZE_ prefix   any object whose name starts with GLAZE_ is window glass:
                    the runtime renders it transparent so the city shows
                    through, and never lets it block the camera
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
COL = "34_interiors"

TAU = math.pi * 2.0

# rgb + tint mask
FLOOR_STONE = (0.240, 0.232, 0.215, 0.0)
FLOOR_WOOD = (0.135, 0.082, 0.045, 0.0)
FLOOR_VINYL = (0.180, 0.178, 0.168, 0.0)
WALL_PALE = (0.330, 0.322, 0.305, 0.0)
WALL_WARM = (0.310, 0.276, 0.238, 0.0)
WALL_DARK = (0.075, 0.072, 0.070, 0.0)
CEILING = (0.360, 0.358, 0.350, 0.0)
PANEL_LIT = (0.900, 0.880, 0.820, 0.0)     # luminous ceiling panel
METAL = (0.145, 0.148, 0.152, 0.0)
BRASS = (0.290, 0.215, 0.095, 0.0)
GLASS = (0.075, 0.090, 0.105, 0.0)
WOOD_DARK = (0.062, 0.038, 0.024, 0.0)
FABRIC = (0.105, 0.108, 0.118, 0.0)
GREEN = (0.045, 0.105, 0.038, 0.0)
STEEL_COLD = (0.190, 0.205, 0.215, 0.0)
PRODUCE = (1.0, 1.0, 1.0, 1.0)             # tinted per instance
SIGN = (0.520, 0.140, 0.110, 0.0)


class Builder:
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
        """A single horizontal quad -- floors and ceilings do not need six
        faces, and at 6,000 triangles a room that matters."""
        v = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
        f = [(0, 1, 2, 3)] if up else [(3, 2, 1, 0)]
        self._add(v, f, rgba)

    def wall(self, x0, y0, x1, y1, z0, z1, rgba, inward=True):
        """A vertical quad from (x0,y0) to (x1,y1)."""
        v = [(x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1)]
        f = [(0, 1, 2, 3)] if inward else [(3, 2, 1, 0)]
        self._add(v, f, rgba)

    def tube(self, cx, cy, z0, z1, r, rgba, seg=8):
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
        self.faces.append(tuple(base + seg + i for i in range(seg)))
        self.cols.extend([rgba] * seg)

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
# shared furniture
# ---------------------------------------------------------------------------
def ceiling_grid(b, x0, x1, y0, y1, z, spacing=3.0):
    """Luminous panels on a regular grid. Interiors are lit by these rather
    than by real lights: a room needs a dozen sources to look lit, and a dozen
    dynamic lights in a browser is not a budget anyone has."""
    n = 0
    x = x0 + spacing * 0.5
    while x < x1:
        y = y0 + spacing * 0.5
        while y < y1:
            b.slab(x - 0.55, x + 0.55, y - 0.28, y + 0.28, z - 0.02,
                   PANEL_LIT, up=False)
            n += 1
            y += spacing
        x += spacing
    return n


def sofa(b, cx, cy, rot_y=False, w=2.10, d=0.86):
    sx, sy = (d, w) if rot_y else (w, d)
    b.box(cx, cy, 0.20, sx, sy, 0.40, FABRIC)
    b.box(cx, cy, 0.50, sx * 0.94, sy * 0.94, 0.20, FABRIC)
    if rot_y:
        b.box(cx - d * 0.42, cy, 0.55, 0.16, sy, 0.70, FABRIC)
    else:
        b.box(cx, cy - d * 0.42, 0.55, sx, 0.16, 0.70, FABRIC)


def table(b, cx, cy, w=1.4, d=0.8, h=0.74, top=WOOD_DARK):
    b.box(cx, cy, h, w, d, 0.06, top)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(cx + sx * (w * 0.44), cy + sy * (d * 0.40), h * 0.5,
                  0.07, 0.07, h, METAL)


# ---------------------------------------------------------------------------
# INT_lobby -- 24 x 15 m, 6 m clear
# ---------------------------------------------------------------------------
def build_lobby(b):
    W, D, H = 24.0, 15.0, 6.0
    y0, y1 = -W * 0.5, W * 0.5

    b.slab(0, D, y0, y1, 0.0, FLOOR_STONE)
    b.slab(0, D, y0, y1, H, CEILING, up=False)
    ceiling_grid(b, 1.0, D - 1.0, y0 + 1.0, y1 - 1.0, H, spacing=3.2)

    # side and back walls. All three face *in*: a room is only ever seen from
    # inside it, and a wall wound the other way is backface-culled there --
    # the player looks through the wall to the city and the culled-from-inside
    # check fails every direction across it (the P2-067 lift-cab class, fixed
    # in 64_corridor.py; the lift's walls are wound in, matching this).
    # wall()'s "inward" flag is traversal-dependent: for the traversals below
    # (near wall x 0->D, far wall x D->0, back wall y y0->y1) the room-facing
    # winding is inward=False. Do not "fix" the flag without checking the
    # normal against the room centre.
    b.wall(0, y0, D, y0, 0, H, WALL_PALE, inward=False)
    b.wall(D, y1, 0, y1, 0, H, WALL_PALE, inward=False)
    b.wall(D, y0, D, y1, 0, H, WALL_WARM, inward=False)

    # street wall: full-height glazing with mullions, and the doors
    b.box(0.0, 0.0, H - 0.25, 0.30, W, 0.50, METAL)      # transom beam
    for k in range(-5, 6):
        b.box(0.0, k * 2.0, H * 0.5, 0.22, 0.16, H, METAL)
    b.box(0.0, 0.0, 0.10, 0.30, W, 0.20, METAL)          # threshold

    # reception: a long desk with a back-lit wall behind it
    b.box(D * 0.62, -W * 0.24, 0.55, 0.9, 6.4, 1.10, WOOD_DARK)
    b.box(D * 0.62, -W * 0.24, 1.13, 1.06, 6.6, 0.06, FLOOR_STONE)
    b.box(D - 0.15, -W * 0.24, 2.4, 0.10, 6.8, 3.2, WALL_DARK)
    b.box(D - 0.22, -W * 0.24, 2.4, 0.04, 6.0, 2.4, BRASS)

    # lift bank in a recess on the far right
    for k in range(3):
        cy = W * 0.14 + k * 2.6
        b.box(D - 0.20, cy, 1.35, 0.12, 1.90, 2.70, METAL)
        b.box(D - 0.26, cy, 1.30, 0.04, 1.60, 2.40, WALL_DARK)
        b.box(D - 0.26, cy, 2.95, 0.05, 0.5, 0.22, PANEL_LIT)

    # columns on a 6 m grid, which is what a tower lobby actually has
    for gx in (D * 0.34, D * 0.72):
        for gy in (-W * 0.30, W * 0.30):
            b.box(gx, gy, H * 0.5, 0.75, 0.75, H, WALL_PALE)

    # seating cluster and planters near the glass
    sofa(b, D * 0.30, W * 0.20)
    sofa(b, D * 0.30, W * 0.20 + 3.0)
    table(b, D * 0.30 + 0.0, W * 0.20 + 1.5, 1.0, 1.0, 0.42, FLOOR_STONE)
    for cy in (-W * 0.40, W * 0.40):
        b.box(2.2, cy, 0.35, 1.0, 1.0, 0.70, WALL_DARK)
        b.tube(2.2, cy, 0.70, 1.85, 0.42, GREEN, seg=8)
    return {"width": W, "depth": D, "height": H, "kind": "lobby"}


def build_lobby_glass(b):
    W, H = 24.0, 6.0
    b.wall(0.02, -W * 0.5, 0.02, W * 0.5, 0.2, H - 0.5, GLASS)
    return {"panes": 1}


# ---------------------------------------------------------------------------
# INT_penthouse -- 18 x 12 m, 3.4 m clear, glazed on two sides
# ---------------------------------------------------------------------------
def build_penthouse(b):
    W, D, H = 18.0, 12.0, 3.4
    y0, y1 = -W * 0.5, W * 0.5

    b.slab(0, D, y0, y1, 0.0, FLOOR_WOOD)
    b.slab(0, D, y0, y1, H, CEILING, up=False)
    ceiling_grid(b, 1.5, D - 1.5, y0 + 2.0, y1 - 2.0, H, spacing=4.0)

    # solid back and one side; the other two sides are glass. Wound *in* so
    # the walls answer a ray from inside the room (P2-067; see build_lobby).
    b.wall(D, y1, D, y0, 0, H, WALL_WARM, inward=True)
    b.wall(D, y0, 0, y0, 0, H, WALL_PALE, inward=True)

    # mullions on the two glazed sides
    for k in range(-4, 5):
        b.box(0.06, k * 2.0, H * 0.5, 0.10, 0.10, H, METAL)
    for k in range(1, 6):
        b.box(k * 2.0, y1 - 0.06, H * 0.5, 0.10, 0.10, H, METAL)
    b.box(0.06, 0.0, H - 0.06, 0.14, W, 0.12, METAL)
    b.box(D * 0.5, y1 - 0.06, H - 0.06, D, 0.14, 0.12, METAL)

    # kitchen island and run along the back wall
    b.box(D * 0.72, -W * 0.26, 0.45, 1.05, 3.4, 0.90, WALL_DARK)
    b.box(D * 0.72, -W * 0.26, 0.92, 1.15, 3.5, 0.05, FLOOR_STONE)
    b.box(D - 0.35, -W * 0.30, 0.45, 0.66, 5.0, 0.90, WALL_DARK)
    b.box(D - 0.35, -W * 0.30, 0.92, 0.72, 5.1, 0.05, FLOOR_STONE)
    b.box(D - 0.35, -W * 0.30, 2.05, 0.62, 5.0, 0.80, WALL_WARM)

    # living: sofas facing the corner glass, low table, rug
    b.slab(D * 0.22, D * 0.62, W * 0.02, W * 0.40, 0.005, FABRIC)
    sofa(b, D * 0.50, W * 0.20, rot_y=True, w=2.6)
    sofa(b, D * 0.28, W * 0.34, w=2.4)
    table(b, D * 0.38, W * 0.20, 1.3, 0.7, 0.38, WOOD_DARK)

    # dining
    table(b, D * 0.30, -W * 0.28, 2.4, 1.0, 0.75, WOOD_DARK)
    for k in (-1, 0, 1):
        for sy in (-1, 1):
            b.box(D * 0.30 + k * 0.7, -W * 0.28 + sy * 0.75, 0.44,
                  0.44, 0.44, 0.88, FABRIC)

    # a stair down, so the room reads as the top of something
    for k in range(7):
        b.box(D * 0.86, W * 0.34 - k * 0.30, 0.0 - k * 0.18 + 0.09,
              2.0, 0.30, 0.18, FLOOR_STONE)
    return {"width": W, "depth": D, "height": H, "kind": "penthouse"}


def build_penthouse_glass(b):
    W, D, H = 18.0, 12.0, 3.4
    b.wall(0.02, -W * 0.5, 0.02, W * 0.5, 0.05, H - 0.15, GLASS)
    b.wall(0.02, W * 0.5 - 0.02, D, W * 0.5 - 0.02, 0.05, H - 0.15, GLASS)
    return {"panes": 2}


# ---------------------------------------------------------------------------
# INT_bodega -- 9 x 12 m, 3.2 m clear
# ---------------------------------------------------------------------------
def build_bodega(b):
    W, D, H = 9.0, 12.0, 3.2
    y0, y1 = -W * 0.5, W * 0.5

    b.slab(0, D, y0, y1, 0.0, FLOOR_VINYL)
    b.slab(0, D, y0, y1, H, CEILING, up=False)
    ceiling_grid(b, 0.8, D - 0.8, y0 + 0.8, y1 - 0.8, H, spacing=2.4)

    # side and back walls, wound in (P2-067; see build_lobby)
    b.wall(0, y0, D, y0, 0, H, WALL_PALE, inward=False)
    b.wall(D, y1, 0, y1, 0, H, WALL_PALE, inward=False)
    b.wall(D, y0, D, y1, 0, H, WALL_PALE, inward=False)
    b.box(0.0, 0.0, H - 0.35, 0.26, W, 0.70, SIGN)       # shop fascia
    for k in range(-2, 3):
        b.box(0.0, k * 2.2, H * 0.5, 0.18, 0.14, H, METAL)

    # chiller wall down the right-hand side
    for k in range(4):
        cy = y1 - 1.2 - k * 2.4
        b.box(D - 0.55, cy, 1.05, 1.05, 2.30, 2.10, STEEL_COLD)
        b.box(D - 1.06, cy, 1.05, 0.05, 2.10, 1.90, GLASS)
        b.box(D - 1.06, cy, 2.18, 0.06, 2.20, 0.14, PANEL_LIT)

    # two aisles of shelving, stocked with tinted boxes
    for a, ax in enumerate((D * 0.36, D * 0.60)):
        b.box(ax, 0.0, 0.90, 0.90, W - 3.2, 1.80, METAL)
        for sy in (-1, 1):
            for shelf in range(4):
                z = 0.35 + shelf * 0.42
                b.box(ax + sy * 0.47, 0.0, z, 0.06, W - 3.3, 0.04, METAL)
                # goods: a run of small tinted boxes, per-instance colour
                n = 9
                for i in range(n):
                    cy = -(W - 3.6) * 0.5 + (i + 0.5) * (W - 3.6) / n
                    b.box(ax + sy * 0.44, cy, z + 0.16, 0.22, 0.26, 0.28,
                          PRODUCE)

    # counter by the door, with a back wall of cigarettes and lottery
    b.box(1.5, y0 + 1.6, 0.55, 2.6, 0.80, 1.10, WOOD_DARK)
    b.box(1.5, y0 + 1.6, 1.12, 2.7, 0.90, 0.05, FLOOR_STONE)
    b.box(1.5, y0 + 0.35, 1.60, 2.6, 0.30, 2.40, WALL_DARK)
    for shelf in range(5):
        b.box(1.5, y0 + 0.48, 0.70 + shelf * 0.42, 2.4, 0.06, 0.04, METAL)

    # produce crates in the window
    for k in range(3):
        b.box(0.9, y1 - 1.2 - k * 1.3, 0.45, 1.2, 1.1, 0.90, WOOD_DARK)
        b.box(0.9, y1 - 1.2 - k * 1.3, 0.95, 1.1, 1.0, 0.16, PRODUCE)
    return {"width": W, "depth": D, "height": H, "kind": "shop"}


def build_bodega_glass(b):
    W, H = 9.0, 3.2
    b.wall(0.02, -W * 0.5, 0.02, W * 0.5, 0.35, H - 0.75, GLASS)
    return {"panes": 1}


ROOMS = [
    ("INT_lobby", build_lobby, "GLAZE_lobby", build_lobby_glass),
    ("INT_penthouse", build_penthouse, "GLAZE_penthouse",
     build_penthouse_glass),
    ("INT_bodega", build_bodega, "GLAZE_bodega", build_bodega_glass),
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

    mat = bpy.data.materials.new("MAT_interior")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.55
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    print("=" * 74)
    print("PHASE 2K  INTERIORS (Blender, procedural)")
    print("=" * 74)
    objs = []
    spec = {}
    for name, fn, gname, gfn in ROOMS:
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
        print("  %-16s %5.1f x %4.1f x %4.1f m  %5d verts  %5d tris "
              "(+%d glass)"
              % (name, dims["width"], dims["depth"], dims["height"],
                 len(ob.data.vertices), b.tris, gb.tris))

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "interiors.glb")
    size = export_glb(objs, path)
    blend = os.path.join(bc.BLEND, "manhattan_interiors.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "rooms": spec,
        "total_tris": sum(v["tris"] + v["glass_tris"] for v in spec.values()),
        "glb_bytes": size,
        "space": "origin on the floor at the middle of the entrance wall, "
                 "+x into the room, +y left, +z up",
        "conventions": {
            "COLOR_0 alpha": "1 = tint per instance, 0 = keep authored rgb",
            "GLAZE_ prefix": "window glass; rendered transparent by the "
                             "runtime and never a camera collider",
            "lighting": "luminous ceiling panels rather than dynamic lights",
        },
        "licence": "generated procedurally; no purchased interior kit, no "
                   "scanned furniture, no photographic texture",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "INTERIOR_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  %d rooms, %d triangles, %.1f KB"
          % (len(ROOMS), report["total_tris"], size / 1024.0))
    print("  saved %s  (%.0fs)"
          % (os.path.relpath(blend, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
