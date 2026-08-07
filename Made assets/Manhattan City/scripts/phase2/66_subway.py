"""
66_subway.py -- Phase 2N: subway entrances, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/66_subway.py

The demand field built in Phase 2I has known which blocks are busy since it
learned to read PLUTO, but it has never known *why* a block is busy. A block
with a station entrance on it carries a different crowd to an identical block
without one, and 868 Manhattan entrances across 121 station complexes were
missing from the model entirely. This is the geometry for them; 67_build_subway.py
places them and folds them into the demand field.

    PROP_subway_stair     the ordinary one: a stair well cut into the
                          pavement, railings on three sides, a lamp post with
                          a globe, and a blank sign panel.
    PROP_subway_elevator  the accessible one: a glazed shaft with a canopy.

On trademarks, since this is street furniture belonging to a transit agency:
**no MTA marks are reproduced here.** There is no roundel, no route bullet, no
wordmark, no station name and no lettering of any kind. The sign is an empty
dark panel with a lit edge. The globe lamps are the generic form of a New York
street lamp -- a sphere on a post -- and carry no insignia. If the real
signage is wanted, that is a licensing question.

Authored in the same frame the rest of the street furniture uses: origin at
the centre of the footprint on the pavement surface, +x along the kerb, +y
across it into the carriageway, +z up. COLOR_0 alpha 1 = tint per instance,
0 = keep the authored rgb.
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
COL = "37_subway"

TAU = math.pi * 2.0

# rgb + tint mask
STEEL = (0.118, 0.122, 0.128, 0.0)
STEEL_PALE = (0.185, 0.190, 0.196, 0.0)
PAINT_GREEN = (0.055, 0.115, 0.075, 0.0)      # the railing colour
VOID = (0.020, 0.020, 0.022, 0.0)             # down the stairwell
STEP = (0.130, 0.130, 0.132, 0.0)
KERB = (0.215, 0.212, 0.204, 0.0)
SIGN = (0.045, 0.046, 0.050, 0.0)
SIGN_EDGE = (0.520, 0.560, 0.600, 0.0)
GLOBE_GREEN = (0.180, 0.780, 0.360, 0.0)      # 24 hour entrance
GLOBE_RED = (0.820, 0.190, 0.170, 0.0)        # restricted hours
GLASS = (0.090, 0.110, 0.125, 0.0)
CANOPY = (0.155, 0.158, 0.162, 0.0)


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

    def tube(self, cx, cy, z0, z1, r, rgba, seg=6, cap_top=True):
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

    def sphere(self, cx, cy, cz, r, rgba, seg=8, rings=4):
        """A low-poly globe. Eight by four is 32 quads, which at 3.4 m up and
        260 mm across is more than the silhouette needs."""
        pts = []
        for j in range(rings + 1):
            phi = math.pi * j / rings
            sz = math.cos(phi) * r
            sr = math.sin(phi) * r
            row = []
            for i in range(seg):
                t = TAU * i / seg
                row.append((cx + math.cos(t) * sr, cy + math.sin(t) * sr,
                            cz + sz))
            pts.append(row)
        base = len(self.verts)
        for row in pts:
            self.verts.extend(row)
        for j in range(rings):
            for i in range(seg):
                i2 = (i + 1) % seg
                self.faces.append((base + j * seg + i, base + j * seg + i2,
                                   base + (j + 1) * seg + i2,
                                   base + (j + 1) * seg + i))
                self.cols.extend([rgba] * 4)

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.faces)

    def to_object(self, name, collection, mat):
        assert_outward(name, self.verts, self.faces)
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


def railing(b, x0, x1, y, z0, h, rgba, posts=5, rail_r=0.035):
    """A run of railing: top rail, mid rail, and posts."""
    for dz in (h, h * 0.55):
        b.box((x0 + x1) * 0.5, y, z0 + dz, abs(x1 - x0), rail_r * 2,
              rail_r * 2, rgba)
    for k in range(posts):
        x = x0 + (x1 - x0) * k / (posts - 1.0)
        b.box(x, y, z0 + h * 0.5, rail_r * 1.8, rail_r * 1.8, h, rgba)


# ---------------------------------------------------------------------------
# PROP_subway_stair -- 3.4 x 2.4 m opening
# ---------------------------------------------------------------------------
W, D = 3.40, 2.40          # along the kerb, across it
RAIL_H = 1.05


def build_stair(b):
    hx, hy = W * 0.5, D * 0.5

    # The opening, and the kerb-stone surround that frames it.
    for sx in (-1, 1):
        b.box(sx * (hx + 0.13), 0.0, 0.03, 0.26, D + 0.52, 0.06, KERB)
    for sy in (-1, 1):
        b.box(0.0, sy * (hy + 0.13), 0.03, W, 0.26, 0.06, KERB)

    # Steps going down. Nine treads is one storey at NYC riser heights, which
    # is as far as anyone can see from the pavement anyway.
    n = 9
    rise, tread = 0.175, 0.30
    for k in range(n):
        z = -rise * (k + 1)
        y = hy - 0.15 - tread * k
        b.slab(-hx + 0.12, hx - 0.12, y - tread, y, z, STEP)
        b.wall(-hx + 0.12, y - tread, hx - 0.12, y - tread, z, z + rise,
               STEP, inward=False)
    # the dark beyond the last visible tread
    b.slab(-hx + 0.12, hx - 0.12, -hy, hy - 0.15 - tread * n, -rise * n, VOID)
    for sx in (-1, 1):
        b.wall(sx * (hx - 0.12), hy - 0.15, sx * (hx - 0.12), -hy,
               -rise * n - 0.4, 0.0, VOID, inward=sx > 0)

    # Railings: both long sides and the closed end. The open end is where you
    # walk in.
    for sy in (-1, 1):
        railing(b, -hx, hx, sy * hy, 0.0, RAIL_H, PAINT_GREEN, posts=6) \
            if sy < 0 else None
    railing(b, -hx, hx, -hy, 0.0, RAIL_H, PAINT_GREEN, posts=6)
    for sx in (-1, 1):
        # side runs, built along y by swapping the axes
        for dz in (RAIL_H, RAIL_H * 0.55):
            b.box(sx * hx, 0.0, dz, 0.07, D, 0.07, PAINT_GREEN)
        for k in range(4):
            y = -hy + D * k / 3.0
            b.box(sx * hx, y, RAIL_H * 0.5, 0.063, 0.063, RAIL_H, PAINT_GREEN)

    # Lamp post with a globe, at the street corner of the opening.
    px, py = hx + 0.34, hy - 0.10
    b.tube(px, py, 0.0, 3.05, 0.055, STEEL, seg=6)
    b.tube(px, py, 0.0, 0.16, 0.10, STEEL, seg=6)
    b.sphere(px, py, 3.25, 0.145, GLOBE_GREEN, seg=8, rings=4)

    # Blank sign panel on the post. No marks: see the module docstring.
    b.box(px - 0.02, py, 2.30, 0.04, 0.62, 0.42, SIGN)
    b.box(px - 0.045, py, 2.30, 0.01, 0.56, 0.05, SIGN_EDGE)
    return {"width": W, "depth": D, "height": 3.40, "kind": "stair",
            "treads": n}


# ---------------------------------------------------------------------------
# PROP_subway_elevator -- 2.2 x 2.2 m shaft
# ---------------------------------------------------------------------------
EW, ED, EH = 2.20, 2.20, 2.85


def build_elevator(b):
    hx, hy = EW * 0.5, ED * 0.5
    # frame
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(sx * (hx - 0.06), sy * (hy - 0.06), EH * 0.5,
                  0.12, 0.12, EH, STEEL)
    for sy in (-1, 1):
        b.box(0.0, sy * (hy - 0.06), EH - 0.06, EW, 0.12, 0.12, STEEL)
    for sx in (-1, 1):
        b.box(sx * (hx - 0.06), 0.0, EH - 0.06, 0.12, ED, 0.12, STEEL)
    # glazed sides, three of them; the fourth is the door
    b.wall(-hx, -hy, hx, -hy, 0.10, EH - 0.14, GLASS)
    for sx in (-1, 1):
        b.wall(sx * hx, -hy, sx * hx, hy, 0.10, EH - 0.14, GLASS,
               inward=sx < 0)
    b.box(0.0, hy, 1.20, EW - 0.30, 0.05, 2.10, GLASS)     # door leaf
    # canopy and a lit soffit
    b.box(0.0, 0.0, EH + 0.07, EW + 0.40, ED + 0.40, 0.14, CANOPY)
    b.slab(-hx, hx, -hy, hy, EH + 0.0, SIGN_EDGE, up=False)
    b.box(0.0, hy + 0.20, EH - 0.02, EW * 0.7, 0.04, 0.18, SIGN)
    b.box(0.0, 0.0, 0.05, EW + 0.30, ED + 0.30, 0.10, KERB)
    return {"width": EW, "depth": ED, "height": EH + 0.14, "kind": "elevator"}


PARTS = [
    ("PROP_subway_stair", build_stair),
    ("PROP_subway_elevator", build_elevator),
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

    mat = bpy.data.materials.new("MAT_subway")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.55
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    print("=" * 74)
    print("PHASE 2N  SUBWAY ENTRANCES (Blender, procedural)")
    print("=" * 74)
    objs = []
    spec = {}
    for name, fn in PARTS:
        b = Builder()
        dims = fn(b)
        ob = b.to_object(name, col, mat)
        objs.append(ob)
        spec[name] = dict(dims, tris=b.tris, verts=len(ob.data.vertices))
        print("  %-22s %5d verts  %5d tris   %.2f x %.2f x %.2f m"
              % (name, len(ob.data.vertices), b.tris, dims["width"],
                 dims["depth"], dims["height"]))

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "subway.glb")
    size = export_glb(objs, path)
    blend = os.path.join(bc.BLEND, "manhattan_subway.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "parts": spec,
        "total_tris": sum(v["tris"] for v in spec.values()),
        "glb_bytes": size,
        "space": "origin at the centre of the footprint on the pavement "
                 "surface, +x along the kerb, +y across it into the "
                 "carriageway, +z up",
        "trademarks": "none reproduced. No roundel, no route bullet, no "
                      "wordmark, no station name, no lettering at all. The "
                      "sign is an empty dark panel with a lit edge; the "
                      "globe lamps carry no insignia.",
        "licence": "generated procedurally; no purchased kit, no scanned "
                   "geometry, no photographic texture",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "SUBWAY_REPORT.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    print("-" * 74)
    print("  %d tris total, %.1f KB glb" % (report["total_tris"],
                                            size / 1024.0))
    print("  blend -> %s" % report["blend"])
    print("  %.1f s" % report["seconds"])


main()
