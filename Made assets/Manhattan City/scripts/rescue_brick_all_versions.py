"""
rescue_brick_all_versions.py — strip Manhattan-build contamination from every
brick_scene_*.blend, writing cleaned copies into project/_cleaned/.

Never modifies an original. Nothing of the artist's is removed: the deletion
list is exactly the objects and collections the Manhattan terrain pass created,
and collections are only removed when empty.

Background: early in the Manhattan build, terrain geometry was written into
whichever file the interactive Blender session had open, because bpy.ops.wm
file operators are deferred over the MCP bridge. That file was then saved, and
every later version (v003..v010) inherited the stray objects.

  blender -b --factory-startup --python rescue_brick_all_versions.py
"""

import glob
import os

import bpy

BASE = r"D:\blender projects\brick_building\project"
OUTDIR = os.path.join(BASE, "_cleaned")

BAD_OBJ_PREFIX = ("LAND_", "WATER_ocean", "BLD_lowrise", "BLD_midrise",
                  "BLD_towers", "ROAD_", "TREE_", "PARK_ground", "PARK_water",
                  "BRIDGE_", "PIER_", "LMK_", "CRV_traffic")
BAD_COLS = ("01_water", "02_landmass", "03_roads", "04_parks", "05_lowrise",
            "06_midrise", "07_towers", "08_landmarks", "09_bridges",
            "10_piers", "11_traffic", "14_exports")


def clean_one(path):
    bpy.ops.wm.open_mainfile(filepath=path)
    before = len(bpy.data.objects)
    removed_o, removed_c = [], []

    for o in list(bpy.data.objects):
        if o.name.startswith(BAD_OBJ_PREFIX):
            d = o.data
            removed_o.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
            if isinstance(d, bpy.types.Mesh) and d.users == 0:
                bpy.data.meshes.remove(d)
            elif isinstance(d, bpy.types.Curve) and d.users == 0:
                bpy.data.curves.remove(d)

    for cn in BAD_COLS:
        c = bpy.data.collections.get(cn)
        # only ever remove an empty collection, so a same-named collection of
        # the artist's that holds work is left alone
        if c is not None and len(c.objects) == 0 and len(c.children) == 0:
            removed_c.append(cn)
            bpy.data.collections.remove(c)

    if not removed_o and not removed_c:
        return {"file": os.path.basename(path), "status": "already clean",
                "objects": before}

    out = os.path.join(OUTDIR, os.path.basename(path))
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True, copy=True)
    return {"file": os.path.basename(path), "status": "cleaned",
            "objects": "%d -> %d" % (before, len(bpy.data.objects)),
            "removed_objects": removed_o, "removed_collections": removed_c,
            "written": out}


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    files = sorted(f for f in glob.glob(os.path.join(BASE, "*.blend"))
                   if "_CLEANED" not in f)
    print("=" * 74)
    print("BRICK PROJECT DECONTAMINATION  (%d files)" % len(files))
    print("originals are never modified; cleaned copies -> %s" % OUTDIR)
    print("=" * 74)
    n_clean = 0
    for p in files:
        try:
            r = clean_one(p)
        except Exception as e:
            print("  %-44s ERROR %s" % (os.path.basename(p), e))
            continue
        if r["status"] == "cleaned":
            n_clean += 1
            print("  %-44s %s  objs %s" % (r["file"], r["status"], r["objects"]))
            print("      removed: %s %s"
                  % (r["removed_objects"], r["removed_collections"]))
        else:
            print("  %-44s %s (%d objs)" % (r["file"], r["status"], r["objects"]))
    print("=" * 74)
    print("cleaned %d of %d files" % (n_clean, len(files)))


if __name__ == "__main__":
    main()
