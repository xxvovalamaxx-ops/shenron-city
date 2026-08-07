"""
rescue_brick_file.py — remove Manhattan-build contamination from the
brick-building file, writing to a NEW path. Never overwrites anything.

Background: early in the Manhattan build, geometry was written into whatever
file the interactive Blender session had open, because bpy.ops.wm file
operators are deferred over the MCP bridge. That file was subsequently saved,
so brick_scene_v002_architecture.blend on disk gained four objects and two
collections that do not belong to it.

This script opens the contaminated file read-only, deletes exactly the objects,
collections and materials the Manhattan build introduced, and saves the result
as *_CLEANED.blend alongside it. The original .blend and the pristine .blend1
backup are both left untouched so the artist can compare and choose.

  blender -b --factory-startup --python rescue_brick_file.py
"""

import os

import bpy

BASE = r"D:\blender projects\brick_building\project"
SRC = os.path.join(BASE, "brick_scene_v002_architecture.blend")
OUT = os.path.join(BASE, "brick_scene_v002_architecture_CLEANED.blend")

# exactly what the Manhattan terrain pass created - nothing else is removed
BAD_OBJECT_PREFIXES = ("LAND_", "WATER_")
BAD_COLLECTIONS = ("01_water", "02_landmass")
BAD_MATERIALS = ("MAT_facade", "MAT_roof", "MAT_water", "MAT_land",
                 "MAT_park", "MAT_tree", "MAT_cable", "MAT_car", "MAT_glass")
# NOTE: MAT_concrete / MAT_asphalt / MAT_steel are deliberately NOT listed -
# the brick project has its own materials with those names.


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)

    before_objs = len(bpy.data.objects)
    removed = {"objects": [], "collections": [], "materials": []}

    for o in list(bpy.data.objects):
        if o.name.startswith(BAD_OBJECT_PREFIXES):
            d = o.data
            removed["objects"].append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
            if isinstance(d, bpy.types.Mesh) and d.users == 0:
                bpy.data.meshes.remove(d)

    for cn in BAD_COLLECTIONS:
        c = bpy.data.collections.get(cn)
        if c is not None:
            removed["collections"].append(cn)
            bpy.data.collections.remove(c)

    for mn in BAD_MATERIALS:
        m = bpy.data.materials.get(mn)
        # only remove if unused, so a same-named brick material is never lost
        if m is not None and m.users == 0:
            removed["materials"].append(mn)
            bpy.data.materials.remove(m)

    for _ in range(2):
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True,
                                       do_recursive=True)

    bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=False, copy=True)

    print("=" * 70)
    print("RESCUE COMPLETE")
    print("  source (untouched) : %s  (%d bytes)" % (SRC, os.path.getsize(SRC)))
    print("  cleaned copy       : %s  (%d bytes)"
          % (OUT, os.path.getsize(OUT) if os.path.exists(OUT) else 0))
    print("  objects            : %d -> %d" % (before_objs, len(bpy.data.objects)))
    print("  removed objects    : %s" % (removed["objects"] or "none"))
    print("  removed collections: %s" % (removed["collections"] or "none"))
    print("  removed materials  : %s" % (removed["materials"] or "none"))
    print("  remaining colls    : %s"
          % ", ".join(sorted(c.name for c in bpy.data.collections)))
    print("=" * 70)
    return removed


if __name__ == "__main__":
    main()
