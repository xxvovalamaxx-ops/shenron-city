"""
52_vehicles.py -- Phase 2F: procedural vehicle fleet, authored in Blender.

    blender -b --factory-startup --python scripts/phase2/52_vehicles.py

Licensing drives the design here, not taste. The project may not ship ripped
game assets, and almost every free car model on the marketplaces forbids
redistribution inside a build, so the fleet is generated from scratch:
recognisable NYC silhouettes, no manufacturer badging, no trademarked grille
shapes, no copied body panels. See docs/phase2/LICENSING.md.

Six types, at real dimensions, low enough poly to instance thousands:

    sedan       4.80 x 1.85 x 1.45   the generic yellow-cab body too
    suv         4.90 x 1.95 x 1.75
    van         5.90 x 2.00 x 2.55   parcel and trade vans
    box_truck   7.60 x 2.40 x 3.30
    bus         12.2 x 2.55 x 3.20   MTA-proportioned, unbranded
    pickup      5.40 x 2.00 x 1.90

Per-instance paint colour travels through COLOR_0's alpha as a mask:

    a = 1   body panel, tinted by the runtime's per-instance colour
    a = 0   glass, tyre, trim, lamp -- keeps its own rgb

So one InstancedMesh per type gives a fleet in any colour with one draw call,
and the glass never turns yellow when the cab does.

Exports exports/vehicles.glb, one object per type, origin at the centre of the
contact patch so the runtime can place them on the road with y = road height.
"""

import json
import math
import os
import sys
import time

import bpy
import bmesh

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
from mesh_audit import assert_outward  # noqa: E402

ROOT = os.path.dirname(SCRIPTS)
DOCS = os.path.join(ROOT, "docs", "phase2")

COL = "30_vehicles"

# rgb + paint mask
BODY = (1.0, 1.0, 1.0, 1.0)          # tinted per instance
GLASS = (0.055, 0.075, 0.095, 0.0)
TYRE = (0.020, 0.020, 0.022, 0.0)
TRIM = (0.085, 0.085, 0.090, 0.0)
LAMP_F = (0.900, 0.880, 0.800, 0.0)
LAMP_R = (0.420, 0.045, 0.035, 0.0)
PLATE = (0.700, 0.690, 0.640, 0.0)


class Builder:
    """Accumulates coloured boxes and cylinders into one mesh."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []          # one rgba per loop

    def _add(self, vs, fs, rgba):
        base = len(self.verts)
        self.verts.extend(vs)
        for f in fs:
            self.faces.append(tuple(base + i for i in f))
            self.cols.extend([rgba] * len(f))

    def box(self, cx, cy, cz, sx, sy, sz, rgba, taper_top=1.0,
            taper_front=1.0):
        """Axis-aligned box. taper_top narrows the top face in y, taper_front
        narrows the +x end -- enough to get a windscreen rake and a tapered
        cabin out of a primitive."""
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        ty = hy * taper_top
        fx = hx * taper_front
        v = [
            (cx - hx, cy - hy, cz - hz), (cx + fx, cy - hy, cz - hz),
            (cx + fx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
            (cx - hx, cy - ty, cz + hz), (cx + fx, cy - ty, cz + hz),
            (cx + fx, cy + ty, cz + hz), (cx - hx, cy + ty, cz + hz),
        ]
        # Wound outward. The first version was inside-out -- signed volume
        # -8 for a 2 m cube -- so backface culling dropped every near face
        # and left you looking at the inside of the far one. On a convex,
        # flat-shaded box that is nearly invisible, which is how it survived
        # five scripts; what gave it away is that a backface is not a raycast
        # hit, so the walk collider let the player through the HQ podium.
        f = [(3, 2, 1, 0), (5, 6, 7, 4), (1, 5, 4, 0),
             (2, 6, 5, 1), (3, 7, 6, 2), (0, 4, 7, 3)]
        self._add(v, f, rgba)

    def wedge(self, x0, x1, cy, sy, z0, z1_front, z1_back, rgba, inset=0.0):
        """A greenhouse: a box whose roof is shorter than its base, giving a
        raked screen at both ends. Cheaper and cleaner than a bevel."""
        hy = sy * 0.5
        v = [
            (x0, cy - hy, z0), (x1, cy - hy, z0),
            (x1, cy + hy, z0), (x0, cy + hy, z0),
            (x0 + inset, cy - hy * 0.92, z1_back),
            (x1 - inset, cy - hy * 0.92, z1_front),
            (x1 - inset, cy + hy * 0.92, z1_front),
            (x0 + inset, cy + hy * 0.92, z1_back),
        ]
        f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        self._add(v, f, rgba)

    def wheel(self, cx, cy, r, width, rgba, seg=8):
        """A cylinder lying on its side, axis along y."""
        hw = width * 0.5
        ring_a = []
        ring_b = []
        for i in range(seg):
            t = 2.0 * math.pi * i / seg
            x = cx + math.cos(t) * r
            z = r + math.sin(t) * r
            ring_a.append((x, cy - hw, z))
            ring_b.append((x, cy + hw, z))
        base = len(self.verts)
        self.verts.extend(ring_a)
        self.verts.extend(ring_b)
        for i in range(seg):
            j = (i + 1) % seg
            self.faces.append((base + i, base + j,
                               base + seg + j, base + seg + i))
            self.cols.extend([rgba] * 4)
        # caps
        self.faces.append(tuple(base + i for i in range(seg)))
        self.cols.extend([rgba] * seg)
        self.faces.append(tuple(base + seg + i for i in range(seg - 1, -1, -1)))
        self.cols.extend([rgba] * seg)

    def to_object(self, name, collection):
        assert_outward(name, self.verts, self.faces)
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate(verbose=False)
        me.update()
        me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))

        # CORNER/FLOAT_COLOR so glTF exports it as COLOR_0 with alpha intact;
        # the alpha is the paint mask the runtime keys instance colour off
        attr = me.color_attributes.new(name="vcol", type='FLOAT_COLOR',
                                       domain='CORNER')
        flat = []
        for c in self.cols:
            flat.extend(c)
        attr.data.foreach_set("color", flat)

        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------------------
# the fleet. x is forward, y is across, z is up, origin on the road surface.
# ---------------------------------------------------------------------------
def build_sedan(b, L=4.80, W=1.85, H=1.45):
    wr = 0.33
    b.box(0.0, 0.0, wr + 0.22, L * 0.98, W, 0.46, BODY)          # body sides
    b.box(0.0, 0.0, wr + 0.05, L, W * 0.96, 0.16, TRIM)          # sill
    b.wedge(-L * 0.30, L * 0.16, 0.0, W * 0.94,
            wr + 0.45, H, H, GLASS, inset=0.30)                  # greenhouse
    b.box(L * 0.40, 0.0, wr + 0.30, L * 0.16, W * 0.86, 0.30,
          BODY, taper_front=0.72)                                # bonnet nose
    b.box(-L * 0.44, 0.0, wr + 0.32, L * 0.12, W * 0.90, 0.34, BODY)
    for sy in (-1, 1):
        b.box(L * 0.47, sy * W * 0.32, wr + 0.30, 0.10, W * 0.22, 0.16, LAMP_F)
        b.box(-L * 0.49, sy * W * 0.32, wr + 0.34, 0.08, W * 0.20, 0.14, LAMP_R)
        b.wheel(L * 0.30, sy * W * 0.46, wr, 0.22, TYRE)
        b.wheel(-L * 0.28, sy * W * 0.46, wr, 0.22, TYRE)
    b.box(L * 0.49, 0.0, wr + 0.14, 0.05, 0.36, 0.13, PLATE)
    return {"length": L, "width": W, "height": H}


def build_suv(b, L=4.90, W=1.95, H=1.78):
    wr = 0.38
    b.box(0.0, 0.0, wr + 0.34, L * 0.98, W, 0.68, BODY)
    b.box(0.0, 0.0, wr + 0.04, L, W * 0.97, 0.14, TRIM)
    b.wedge(-L * 0.36, L * 0.20, 0.0, W * 0.95,
            wr + 0.68, H, H, GLASS, inset=0.22)
    b.box(L * 0.42, 0.0, wr + 0.42, L * 0.14, W * 0.92, 0.44,
          BODY, taper_front=0.86)
    for sy in (-1, 1):
        b.box(L * 0.48, sy * W * 0.32, wr + 0.44, 0.09, W * 0.22, 0.18, LAMP_F)
        b.box(-L * 0.49, sy * W * 0.34, wr + 0.52, 0.07, W * 0.16, 0.30, LAMP_R)
        b.wheel(L * 0.31, sy * W * 0.46, wr, 0.25, TYRE)
        b.wheel(-L * 0.30, sy * W * 0.46, wr, 0.25, TYRE)
    return {"length": L, "width": W, "height": H}


def build_van(b, L=5.90, W=2.00, H=2.55):
    wr = 0.36
    b.box(-L * 0.10, 0.0, wr + 0.95, L * 0.76, W, 1.86, BODY)     # cargo box
    b.box(L * 0.36, 0.0, wr + 0.62, L * 0.24, W * 0.98, 1.20,
          BODY, taper_front=0.90)                                 # cab
    b.wedge(L * 0.30, L * 0.47, 0.0, W * 0.94,
            wr + 1.05, wr + 1.55, wr + 1.62, GLASS, inset=0.10)
    b.box(0.0, 0.0, wr + 0.06, L, W * 0.96, 0.16, TRIM)
    for sy in (-1, 1):
        b.box(L * 0.49, sy * W * 0.34, wr + 0.42, 0.07, W * 0.20, 0.20, LAMP_F)
        b.box(-L * 0.49, sy * W * 0.36, wr + 0.55, 0.06, W * 0.16, 0.42, LAMP_R)
        b.wheel(L * 0.33, sy * W * 0.46, wr, 0.24, TYRE)
        b.wheel(-L * 0.26, sy * W * 0.46, wr, 0.24, TYRE)
    return {"length": L, "width": W, "height": H}


def build_box_truck(b, L=7.60, W=2.40, H=3.30):
    wr = 0.45
    b.box(-L * 0.14, 0.0, wr + 1.35, L * 0.68, W, 2.50, BODY)     # box
    b.box(L * 0.35, 0.0, wr + 0.85, L * 0.30, W * 0.94, 1.65, TRIM)  # cab
    b.wedge(L * 0.28, L * 0.48, 0.0, W * 0.90,
            wr + 1.15, wr + 1.65, wr + 1.68, GLASS, inset=0.08)
    b.box(0.0, 0.0, wr + 0.08, L, W * 0.94, 0.18, TRIM)
    for sy in (-1, 1):
        b.box(L * 0.50, sy * W * 0.34, wr + 0.48, 0.07, W * 0.20, 0.22, LAMP_F)
        b.box(-L * 0.49, sy * W * 0.36, wr + 0.60, 0.06, W * 0.16, 0.40, LAMP_R)
        b.wheel(L * 0.33, sy * W * 0.44, wr, 0.28, TYRE)
        b.wheel(-L * 0.24, sy * W * 0.44, wr, 0.30, TYRE)
        b.wheel(-L * 0.34, sy * W * 0.44, wr, 0.30, TYRE)
    return {"length": L, "width": W, "height": H}


def build_bus(b, L=12.2, W=2.55, H=3.20):
    wr = 0.46
    b.box(0.0, 0.0, wr + 1.30, L, W, 2.30, BODY)
    # window band down both sides, inset so it reads as glass not paint
    b.box(-L * 0.02, 0.0, wr + 1.72, L * 0.94, W * 1.005, 0.95, GLASS)
    b.box(L * 0.49, 0.0, wr + 1.65, 0.06, W * 0.90, 1.05, GLASS)
    b.box(-L * 0.49, 0.0, wr + 1.65, 0.06, W * 0.90, 1.00, GLASS)
    b.box(0.0, 0.0, wr + 0.10, L, W * 0.96, 0.24, TRIM)
    for sy in (-1, 1):
        b.box(L * 0.50, sy * W * 0.35, wr + 0.42, 0.06, W * 0.18, 0.24, LAMP_F)
        b.box(-L * 0.50, sy * W * 0.36, wr + 0.50, 0.05, W * 0.16, 0.34, LAMP_R)
        b.wheel(L * 0.36, sy * W * 0.44, wr, 0.30, TYRE)
        b.wheel(-L * 0.28, sy * W * 0.44, wr, 0.32, TYRE)
    return {"length": L, "width": W, "height": H}


def build_pickup(b, L=5.40, W=2.00, H=1.90):
    wr = 0.38
    b.box(L * 0.12, 0.0, wr + 0.38, L * 0.55, W, 0.74, BODY)      # cab mass
    b.box(-L * 0.30, 0.0, wr + 0.40, L * 0.42, W, 0.60, BODY)     # bed sides
    b.box(-L * 0.30, 0.0, wr + 0.20, L * 0.40, W * 0.86, 0.16, TRIM)
    b.wedge(-L * 0.06, L * 0.26, 0.0, W * 0.94,
            wr + 0.74, H, H, GLASS, inset=0.22)
    b.box(L * 0.42, 0.0, wr + 0.46, L * 0.14, W * 0.94, 0.52,
          BODY, taper_front=0.90)
    b.box(0.0, 0.0, wr + 0.04, L, W * 0.96, 0.14, TRIM)
    for sy in (-1, 1):
        b.box(L * 0.48, sy * W * 0.32, wr + 0.48, 0.08, W * 0.22, 0.20, LAMP_F)
        b.box(-L * 0.50, sy * W * 0.34, wr + 0.52, 0.06, W * 0.18, 0.22, LAMP_R)
        b.wheel(L * 0.32, sy * W * 0.46, wr, 0.26, TYRE)
        b.wheel(-L * 0.32, sy * W * 0.46, wr, 0.26, TYRE)
    return {"length": L, "width": W, "height": H}


FLEET = [
    ("VEH_sedan", build_sedan),
    ("VEH_suv", build_suv),
    ("VEH_van", build_van),
    ("VEH_box_truck", build_box_truck),
    ("VEH_bus", build_bus),
    ("VEH_pickup", build_pickup),
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
        # No Draco. The fleet is a few thousand triangles, so compression
        # saves nothing worth having, and position quantization is what put
        # the ground plane 40 cm out of place (P2-022).
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

    mat = bpy.data.materials.new("MAT_vehicle")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.35
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    objs = []
    spec = {}
    print("=" * 74)
    print("PHASE 2F  VEHICLE FLEET (Blender, procedural, unbranded)")
    print("=" * 74)
    for name, fn in FLEET:
        b = Builder()
        dims = fn(b)
        ob = b.to_object(name, col)
        ob.data.materials.append(mat)
        objs.append(ob)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        spec[name] = dict(dims, tris=tris, verts=len(ob.data.vertices))
        print("  %-16s %5.2f x %4.2f x %4.2f m   %4d verts  %4d tris"
              % (name, dims["length"], dims["width"], dims["height"],
                 len(ob.data.vertices), tris))

    os.makedirs(bc.EXPORTS, exist_ok=True)
    path = os.path.join(bc.EXPORTS, "vehicles.glb")
    size = export_glb(objs, path)

    blend = os.path.join(bc.BLEND, "manhattan_vehicles.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)

    report = {
        "types": len(FLEET),
        "fleet": spec,
        "total_tris": sum(v["tris"] for v in spec.values()),
        "glb_bytes": size,
        "paint_mask": "COLOR_0 alpha: 1 = tint per instance, 0 = keep rgb",
        "licence": "generated procedurally; no third-party model, no badging",
        "blend": os.path.relpath(blend, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "VEHICLE_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  fleet total     : %d triangles" % report["total_tris"])
    print("  exported        : %s  (%.1f KB)"
          % (os.path.relpath(path, ROOT), size / 1024.0))
    print("  saved           : %s  (%.0fs)"
          % (os.path.relpath(blend, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
