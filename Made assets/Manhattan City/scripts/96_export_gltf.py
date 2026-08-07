"""
96_export_gltf.py — game-ready glTF export of the Manhattan world.

Usage:
  blender -b --python 96_export_gltf.py -- [--tiles] [--no-draco] [--lod N]

Produces .glb files under exports/ that load directly in three.js.

Notes for downstream use
------------------------
* Per-building colour travels in the COLOR_0 vertex attribute (Blender's
  "bcol"). In three.js set `vertexColors: true` on the material and you get all
  46k building colours with one draw call per tile - no textures needed.
* Blender is Z-up and glTF is Y-up; the exporter handles the conversion, so
  imported geometry is already correct for three.js' default Y-up world.
* --tiles writes one .glb per spatial chunk so a viewer can stream/frustum-cull
  the island instead of loading 230 MB up front.
* Traffic is a Geometry Nodes instancer. It is exported with the modifier
  applied (real geometry) only when explicitly requested, because it roughly
  doubles the vertex count; for a web build it is usually better to re-implement
  the cars as an InstancedMesh driven by the exported lane curves.
"""

import os
import sys
import time

import bpy

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402

WORLD_COLLECTIONS = ["01_water", "02_landmass", "03_roads", "04_parks",
                     "05_lowrise", "06_midrise", "07_towers", "08_landmarks",
                     "09_bridges", "10_piers"]


def select_only(objs):
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        try:
            o.select_set(True)
        except RuntimeError:
            pass
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def export_glb(objs, path, draco=True):
    select_only(objs)
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        # Required for the "_bid" building-id accessor to survive. Without it
        # the exporter silently drops custom attributes and the GLB arrives
        # with only POSITION/NORMAL/COLOR_0 - i.e. no way to identify a
        # building at runtime.
        export_attributes=True,
    )
    # In Blender 5.x export_vertex_color is an ENUM (MATERIAL/ACTIVE/NAME/NONE),
    # not a bool. Target "bcol" by name so COLOR_0 is guaranteed to carry the
    # per-building colour regardless of which attribute happens to be active.
    kwargs["export_vertex_color"] = 'NAME'
    kwargs["export_vertex_color_name"] = "bcol"
    kwargs["export_all_vertex_colors"] = False
    kwargs["export_active_vertex_color_when_no_material"] = True
    if draco:
        kwargs["export_draco_mesh_compression_enable"] = True
        kwargs["export_draco_mesh_compression_level"] = 6

    op = bpy.ops.export_scene.gltf
    valid = set(op.get_rna_type().properties.keys())
    kwargs = {k: v for k, v in kwargs.items() if k in valid}
    op(**kwargs)
    return os.path.getsize(path) if os.path.exists(path) else 0


def main(argv):
    blend = os.path.join(bc.BLEND, "manhattan_world.blend")
    if bpy.data.filepath != blend:
        bpy.ops.wm.open_mainfile(filepath=blend)

    os.makedirs(bc.EXPORTS, exist_ok=True)
    draco = "--no-draco" not in argv
    per_tile = "--tiles" in argv

    world = []
    for cn in WORLD_COLLECTIONS:
        col = bpy.data.collections.get(cn)
        if col:
            world.extend([o for o in col.objects
                          if o.type == 'MESH' and not o.hide_render])

    out = []
    t0 = time.time()

    if per_tile:
        # group by the tile suffix baked into the object names
        tiles = {}
        for o in world:
            parts = o.name.rsplit("_", 2)
            key = "_".join(parts[-2:]) if len(parts) == 3 and \
                parts[-1].lstrip("+-").isdigit() else "base"
            tiles.setdefault(key, []).append(o)
        for key, objs in sorted(tiles.items()):
            p = os.path.join(bc.EXPORTS, "manhattan_%s.glb" % key)
            sz = export_glb(objs, p, draco)
            out.append({"file": os.path.basename(p), "objects": len(objs),
                        "mb": round(sz / 1e6, 2)})
    else:
        p = os.path.join(bc.EXPORTS, "manhattan_world.glb")
        sz = export_glb(world, p, draco)
        out.append({"file": os.path.basename(p), "objects": len(world),
                    "mb": round(sz / 1e6, 2)})

    total = sum(o["mb"] for o in out)
    print("[gltf] %d file(s), %.1f MB total, %.1fs"
          % (len(out), total, time.time() - t0))
    for o in out[:20]:
        print("   %-34s %4d objs  %7.2f MB" % (o["file"], o["objects"], o["mb"]))
    return {"files": len(out), "total_mb": round(total, 1), "detail": out[:20]}


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    result = main(argv)
