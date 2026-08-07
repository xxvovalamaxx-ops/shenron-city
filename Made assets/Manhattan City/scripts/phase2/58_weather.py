"""
58_weather.py -- Phase 2J: weather geometry, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/58_weather.py

Everything a weather system needs that is a *mesh* rather than a shader. The
licensing position is the same as the fleet and the crowd: nothing bought,
nothing downloaded, nothing traced. Clouds in particular are where projects
reach for a purchased HDRI or a scraped sky photograph, and this project may
not (docs/phase2/LICENSING.md, rules 2 and 3).

    CLOUD_puff_a/b/c   low-poly cumulus lumps, instanced across the sky at
                       varying scale; three silhouettes is enough variety at
                       the distance a cloud is ever seen from
    RAIN_streak        a single elongated quad pair, instanced by the
                       thousand and scrolled through a box around the camera
    RAIN_splash        a flat ring that scales up and fades, for the impact
    PROP_umbrella      carried by part of the crowd once it is raining

Colour convention matches the fleet and the props: COLOR_0's alpha is a mask,
1 = tint this by the per-instance colour, 0 = keep the authored rgb. Cloud
bodies and umbrella canopies are authored white and tinted at runtime, so the
same mesh serves an overcast morning and a lit evening.
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
COL = "33_weather"

TAU = math.pi * 2.0
TINT = (1.0, 1.0, 1.0, 1.0)          # tinted per instance

# Rain and splash carry alpha 1, not the 0 the paint mask uses elsewhere.
# Their runtime material is MeshBasicMaterial with vertexColors, and three
# multiplies COLOR_0's alpha straight into opacity when USE_COLOR_ALPHA is
# defined -- so the mask convention made 2,550 drops perfectly invisible while
# the clouds, authored at alpha 1, rendered fine. The clouds are what proved
# it. Transparency for these is the material's opacity, not the vertex alpha.
RAIN = (0.62, 0.68, 0.76, 1.0)
SPLASH = (0.72, 0.78, 0.84, 1.0)
HANDLE = (0.045, 0.040, 0.036, 0.0)
FERRULE = (0.100, 0.100, 0.105, 0.0)


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

    def quad(self, pts, rgba):
        self._add(pts, [(0, 1, 2, 3)], rgba)

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

    def blob(self, cx, cy, cz, rx, ry, rz, rgba, seg=8, rings=4, squash=1.0):
        lat = []
        for k in range(rings + 1):
            a = math.pi * (k / rings) - math.pi * 0.5
            # squash flattens the underside, which is what makes a lump read
            # as a cloud rather than as a ball
            s = math.sin(a)
            lat.append((math.cos(a), s * (squash if s < 0 else 1.0)))
        base = len(self.verts)
        for k in range(rings + 1):
            c, s = lat[k]
            if k == 0 or k == rings:
                self.verts.append((cx, cy, cz + s * rz))
            else:
                for i in range(seg):
                    t = TAU * i / seg
                    self.verts.append((cx + math.cos(t) * c * rx,
                                       cy + math.sin(t) * c * ry,
                                       cz + s * rz))

        def ix(k, i):
            if k == 0:
                return base
            if k == rings:
                return base + 1 + (rings - 1) * seg
            return base + 1 + (k - 1) * seg + (i % seg)

        for k in range(rings):
            for i in range(seg):
                a, b = ix(k, i), ix(k, i + 1)
                c2, d = ix(k + 1, i + 1), ix(k + 1, i)
                f = (a, c2, d) if k == 0 else \
                    ((a, b, c2) if k == rings - 1 else (a, b, c2, d))
                self.faces.append(f)
                self.cols.extend([rgba] * len(f))

    def ring(self, cz, r_in, r_out, rgba, seg=16):
        base = len(self.verts)
        for i in range(seg):
            t = TAU * i / seg
            c, s = math.cos(t), math.sin(t)
            self.verts.append((c * r_in, s * r_in, cz))
            self.verts.append((c * r_out, s * r_out, cz))
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i * 2, base + i * 2 + 1,
                               base + j * 2 + 1, base + j * 2))
            self.cols.extend([rgba] * 4)

    def tube(self, cx, cy, z0, z1, r0, r1, rgba, seg=6):
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

    def to_object(self, name, collection):
        assert_outward(name, self.verts, self.faces)
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
        attr = me.color_attributes.new(name="vcol", type='FLOAT_COLOR',
                                       domain='CORNER')
        # validate() silently drops degenerate and duplicate faces, and a
        # per-loop colour array written against the pre-validate face list is
        # then the wrong length. Blender's own error for that is "internal
        # error setting the array", which says nothing about the cause.
        if len(self.cols) != len(me.loops):
            raise RuntimeError(
                "%s: %d colours for %d loops -- mesh.validate() dropped %d "
                "faces, most likely duplicates or degenerates"
                % (name, len(self.cols), len(me.loops),
                   len(self.faces) - len(me.polygons)))
        flat = []
        for c in self.cols:
            flat.extend(c)
        attr.data.foreach_set("color", flat)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------------------
# clouds. Authored at roughly 300 m across; the runtime scales each instance.
# ---------------------------------------------------------------------------
def cloud_a(b):
    for dx, dy, dz, r in ((0, 0, 0, 100), (95, 20, -18, 68), (-88, -12, -22, 62),
                          (30, -55, -14, 58), (-25, 50, -8, 64)):
        b.blob(dx, dy, dz + 40, r, r * 0.86, r * 0.62, TINT,
               seg=8, rings=4, squash=0.42)
    return {"span": 300.0}


def cloud_b(b):
    for dx, dy, dz, r in ((0, 0, 0, 78), (72, 8, 16, 62), (-66, 14, 8, 55),
                          (128, -6, -12, 40), (-120, -8, -14, 36)):
        b.blob(dx, dy, dz + 30, r, r * 0.80, r * 0.50, TINT,
               seg=8, rings=3, squash=0.35)
    return {"span": 330.0}


def cloud_c(b):
    for dx, dy, dz, r in ((0, 0, 20, 120), (70, 40, -10, 70),
                          (-80, 30, -16, 60)):
        b.blob(dx, dy, dz + 55, r, r * 0.92, r * 0.78, TINT,
               seg=10, rings=4, squash=0.55)
    return {"span": 300.0}


def rain_streak(b):
    """Two crossed quads so a drop reads from any heading without billboarding
    on the CPU. A falling drop is a streak at any shutter a screen can show.

    Width is set by the screen, not by physics. At a 62 degree field of view
    across 1280 pixels, one pixel is about 19 mm at 20 m -- so the physically
    honest 6 mm streak this started at covered a third of a pixel and 2,550 of
    them were completely invisible. 36 mm is roughly two pixels at 20 m, which
    is what rain has to be to read at all."""
    w, h = 0.018, 0.55
    b.quad([(-w, 0, 0), (w, 0, 0), (w, 0, h), (-w, 0, h)], RAIN)
    b.quad([(0, -w, 0), (0, w, 0), (0, w, h), (0, -w, h)], RAIN)
    return {"length": h}


def rain_splash(b):
    b.ring(0.0, 0.055, 0.10, SPLASH, seg=12)
    return {"radius": 0.10}


def umbrella(b):
    """Canopy as a shallow eight-gore cone, authored white so the crowd's
    per-instance colour tints it."""
    seg = 8
    r = 0.52
    z_edge = 1.62
    z_top = 1.84
    base = len(b.verts)
    for i in range(seg):
        t = TAU * i / seg
        b.verts.append((math.cos(t) * r, math.sin(t) * r, z_edge))
    b.verts.append((0.0, 0.0, z_top))
    tip = base + seg
    for i in range(seg):
        j = (i + 1) % seg
        b.faces.append((base + i, base + j, tip))
        b.cols.extend([TINT] * 3)

    # The underside is a second shell, not the same triangles wound backwards.
    # Reversed duplicates share a vertex set, mesh.validate() removes them as
    # duplicate faces, and the per-loop colour array is then longer than the
    # mesh -- which is exactly how this failed the first time.
    drop = 0.02
    base2 = len(b.verts)
    for i in range(seg):
        t = TAU * i / seg
        b.verts.append((math.cos(t) * r * 0.985, math.sin(t) * r * 0.985,
                        z_edge - drop))
    b.verts.append((0.0, 0.0, z_top - drop))
    tip2 = base2 + seg
    for i in range(seg):
        j = (i + 1) % seg
        b.faces.append((base2 + j, base2 + i, tip2))
        b.cols.extend([TINT] * 3)
    b.tube(0.0, 0.0, 0.95, z_top, 0.012, 0.012, HANDLE)
    b.tube(0.0, 0.0, 0.86, 0.95, 0.020, 0.014, FERRULE)
    return {"radius": r, "height": z_top}


PARTS = [
    ("CLOUD_puff_a", cloud_a),
    ("CLOUD_puff_b", cloud_b),
    ("CLOUD_puff_c", cloud_c),
    ("RAIN_streak", rain_streak),
    ("RAIN_splash", rain_splash),
    ("PROP_umbrella", umbrella),
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
        # No Draco: a few thousand triangles, and quantization is what buried
        # the road surface in P2-022.
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

    mat = bpy.data.materials.new("MAT_weather")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.95
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    print("=" * 74)
    print("PHASE 2J  WEATHER GEOMETRY (Blender, procedural)")
    print("=" * 74)
    objs = []
    spec = {}
    for name, fn in PARTS:
        b = Builder()
        dims = fn(b)
        ob = b.to_object(name, col)
        ob.data.materials.append(mat)
        objs.append(ob)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        spec[name] = dict(dims, tris=tris, verts=len(ob.data.vertices))
        print("  %-18s %5d verts  %5d tris   %s"
              % (name, len(ob.data.vertices), tris,
                 " ".join("%s=%.2f" % kv for kv in dims.items())))

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "weather.glb")
    size = export_glb(objs, path)
    blend = os.path.join(bc.BLEND, "manhattan_weather.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "parts": spec,
        "total_tris": sum(v["tris"] for v in spec.values()),
        "glb_bytes": size,
        "tint_mask": "COLOR_0 alpha: 1 = tint per instance, 0 = keep rgb",
        "licence": "generated procedurally; no purchased HDRI, no sky "
                   "photograph, no third-party mesh",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "WEATHER_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  %d parts, %d triangles, %.1f KB"
          % (len(PARTS), report["total_tris"], size / 1024.0))
    print("  saved %s  (%.0fs)"
          % (os.path.relpath(blend, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
