"""
46_export_runtime_tiles.py -- Phase 2C: re-export the world for the runtime.

    blender -b --factory-startup --python scripts/phase2/46_export_runtime_tiles.py

Why this exists rather than reusing 96_export_gltf.py: five of the Phase 1
materials build their colour in a Blender node graph (noise -> colour ramp ->
Base Color). glTF has no equivalent, so the exporter writes
`baseColorFactor = white` and the ground, roads, parks, trees and concrete all
arrive in the browser as blank white. From the air the entire island was a
blown-out white plane.

The fix is to flatten those graphs to the constant colour they average to,
*in memory only*, immediately before export. Phase 1 scripts are frozen and
the .blend on disk is never written back, so the authored look is untouched;
only the exported glb changes.

The flattened values are the midpoints of the colour ramps in
scripts/15_materials.py, so they come from the source of truth rather than
from taste.

Options:
  --no-draco     skip Draco compression (bigger files, faster export)
  --only-base    re-export just manhattan_base.glb (land, water, bridges)
  --streets      export the Phase 2E street layer from manhattan_streets.blend
                 instead, as streets_<tile>.glb
"""

import os
import sys
import time

import bpy

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402

WORLD_COLLECTIONS = ["01_water", "02_landmass", "03_roads", "04_parks",
                     "05_lowrise", "06_midrise", "07_towers", "08_landmarks",
                     "09_bridges", "10_piers"]

# material name -> linear RGB, the midpoint of the ramp in 15_materials.py
FLATTEN = {
    "MAT_land":     (0.050, 0.048, 0.045),
    "MAT_asphalt":  (0.028, 0.028, 0.031),
    "MAT_park":     (0.042, 0.085, 0.023),
    "MAT_tree":     (0.029, 0.062, 0.016),
    "MAT_concrete": (0.158, 0.155, 0.148),
}


def flatten_materials():
    """Disconnect the Base Color input and set a constant. In memory only."""
    done = []
    for name, rgb in FLATTEN.items():
        m = bpy.data.materials.get(name)
        if not m or not m.use_nodes:
            continue
        bsdf = next((n for n in m.node_tree.nodes
                     if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        inp = bsdf.inputs["Base Color"]
        for link in list(inp.links):
            m.node_tree.links.remove(link)
        inp.default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        done.append(name)
    return done


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
        # without this the "_bid" accessor is silently dropped and there is no
        # way to identify a building at runtime -- regression requirement R14
        export_attributes=True,
    )
    kwargs["export_vertex_color"] = 'NAME'
    kwargs["export_vertex_color_name"] = "bcol"
    kwargs["export_all_vertex_colors"] = False
    kwargs["export_active_vertex_color_when_no_material"] = True
    if draco:
        kwargs["export_draco_mesh_compression_enable"] = True
        kwargs["export_draco_mesh_compression_level"] = 6
        # Draco's defaults are lossy in ways that matter at city scale, and
        # both defaults were silently corrupting the build:
        #
        # positions, 14 bits: quantized across each mesh's own bounding box.
        #   LAND_manhattan spans 14.4 km, so the step is 0.88 m and a vertex
        #   authored at z = 12.00 arrived at 12.407. That is more than the
        #   50 mm the roads sit proud of the land, so every road, kerb and
        #   lane marking in the city was buried under the ground plane.
        #   20 bits puts the land's step at 14 mm and a 1.4 km tile's at
        #   1.3 mm.
        #
        # generic, 12 bits: this covers custom attributes, which means _bid.
        #   Across a 0-56,475 range the step is ~14, so 83% of building ids
        #   arrived non-integer and picking returned a neighbour's record.
        #   24 bits makes the id exact.
        kwargs["export_draco_position_quantization"] = 20
        kwargs["export_draco_generic_quantization"] = 24

    op = bpy.ops.export_scene.gltf
    valid = set(op.get_rna_type().properties.keys())
    op(**{k: v for k, v in kwargs.items() if k in valid})
    return os.path.getsize(path) if os.path.exists(path) else 0


def export_streets(draco):
    """Phase 2E layer: sidewalks and road markings, its own tile set."""
    blend = os.path.join(bc.BLEND, "manhattan_streets.blend")
    if not os.path.exists(blend):
        print("[streets] %s not found -- run 50_streets.py first" % blend)
        return {"files": 0, "mb": 0.0}
    bpy.ops.wm.open_mainfile(filepath=blend)

    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    tiles = {}
    for o in objs:
        parts = o.name.rsplit("_", 2)
        if len(parts) == 3 and parts[-1].lstrip("+-").isdigit():
            tiles.setdefault("_".join(parts[-2:]), []).append(o)
        else:
            tiles.setdefault("base", []).append(o)

    os.makedirs(bc.EXPORTS, exist_ok=True)
    t0 = time.time()
    total = 0
    for key, group in sorted(tiles.items()):
        p = os.path.join(bc.EXPORTS, "streets_%s.glb" % key)
        sz = export_glb(group, p, draco)
        total += sz
        print("  %-28s %4d objs  %7.2f MB"
              % (os.path.basename(p), len(group), sz / 1e6))
    print("[streets] %d file(s), %.1f MB, %.0fs"
          % (len(tiles), total / 1e6, time.time() - t0))
    return {"files": len(tiles), "mb": round(total / 1e6, 1)}


def main(argv):
    draco = "--no-draco" not in argv
    if "--streets" in argv:
        return export_streets(draco)

    blend = os.path.join(bc.BLEND, "manhattan_world.blend")
    if bpy.data.filepath != blend:
        bpy.ops.wm.open_mainfile(filepath=blend)

    only_base = "--only-base" in argv

    flat = flatten_materials()
    print("[flatten] %d materials -> constant base colour: %s"
          % (len(flat), ", ".join(flat)))
    missing = [n for n in FLATTEN if n not in flat]
    if missing:
        print("[flatten] NOT FOUND, still white in the export: %s"
              % ", ".join(missing))

    world = []
    for cn in WORLD_COLLECTIONS:
        col = bpy.data.collections.get(cn)
        if col:
            world.extend([o for o in col.objects
                          if o.type == 'MESH' and not o.hide_render])

    tiles = {}
    for o in world:
        parts = o.name.rsplit("_", 2)
        key = "_".join(parts[-2:]) if len(parts) == 3 and \
            parts[-1].lstrip("+-").isdigit() else "base"
        tiles.setdefault(key, []).append(o)

    os.makedirs(bc.EXPORTS, exist_ok=True)
    t0 = time.time()
    total = 0
    n = 0
    for key, objs in sorted(tiles.items()):
        if only_base and key != "base":
            continue
        p = os.path.join(bc.EXPORTS, "manhattan_%s.glb" % key)
        sz = export_glb(objs, p, draco)
        total += sz
        n += 1
        print("  %-28s %4d objs  %7.2f MB" % (os.path.basename(p), len(objs),
                                              sz / 1e6))

    print("[export] %d file(s), %.1f MB, %.0fs"
          % (n, total / 1e6, time.time() - t0))
    return {"files": n, "mb": round(total / 1e6, 1), "flattened": flat}


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
