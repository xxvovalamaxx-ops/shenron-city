"""
Build the Shenzhen City asset museum: one Blender file that displays the
entire 3D content of the public library, organized in collections per
category, one row per pack, each model with its name floating above it.

Run headless:
  blender --background --python scripts/assets/build-asset-museum.py
"""
import bpy
import os
import math

LIBRARY = "SourceAssets/PublicLibrary"
OUT = "SourceAssets/Museum/asset_museum.blend"

# Category -> (collection name, sorted pack subpaths)
CATEGORIES = [
    ("Buildings", [
        "Buildings/City", "Buildings/Modular",
        "Kenney/kenney-fantasy-town-kit", "Kenney/kenney-retro-urban-kit",
        "Kenney/kenney-factory-kit", "Kenney/kenney-space-station-kit",
        "Kenney/kenney-modular-space-kit", "Kenney/kenney-modular-cave-kit",
        "Kenney/kenney-modular-dungeon-kit", "Kenney/kenney-graveyard-kit",
    ]),
    ("Vehicles", [
        "Vehicles/Cars", "Kenney/kenney-train-kit", "Kenney/kenney-watercraft-kit",
        "Kenney/kenney-space-kit", "Kenney/kenney-racing-kit",
    ]),
    ("Characters", [
        "Characters/Animated", "Kenney/kenney-cube-pets", "Kenney/kenney-mini-arena",
    ]),
    ("Nature", [
        "Environment/Nature", "Kenney/kenney-mini-forest",
    ]),
    ("Street & Props", [
        "Props/Market", "Props/Quaternius", "Props/Prototype", "Props/Interior",
        "Kenney/kenney-platformer-kit", "Kenney/kenney-retro-fantasy-kit",
        "Kenney/kenney-pirate-kit", "Kenney/kenney-survival-kit",
        "Kenney/kenney-blaster-kit", "Kenney/kenney-mini-market",
        "Kenney/kenney-mini-skate", "Kenney/kenney-mini-arcade", "Kenney/kenney-mini-dungeon",
    ]),
]

MAX_MODELS_PER_PACK = 8
SPACING_X = 3.0
SPACING_ROW = 6.0
SPACING_CATEGORY = 14.0
LABEL_HEIGHT = 3.2

MODEL_EXTENSIONS = (".glb", ".gltf", ".obj", ".fbx")
EXCLUDE_PARTS = ("floor-panel", "pipe-", "rail-", "wall-corner", "structure-",
                 "tower-middle", "tower-top", "tower-roof", "tower-base",
                 "mast-", "flag-", "patch-", "grass-", "rocks", "rock-")

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for col in list(bpy.data.collections):
        if col.users == 0:
            bpy.data.collections.remove(col)
    if bpy.context.scene.collection.children:
        for child in list(bpy.context.scene.collection.children):
            bpy.context.scene.collection.children.unlink(child)

def ensure_collection(name):
    if name in bpy.data.collections:
        return bpy.data.collections[name]
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col

def pick_models(pack_dir):
    """Pick up to MAX_MODELS_PER_PACK representative 3D files from a pack."""
    found = []
    for root, _dirs, files in os.walk(pack_dir):
        for name in sorted(files):
            if not name.lower().endswith(MODEL_EXTENSIONS):
                continue
            base = name.lower()
            if any(ex in base for ex in EXCLUDE_PARTS):
                continue
            found.append(os.path.join(root, name))
    # prefer glb/gltf, then obj, then fbx
    found.sort(key=lambda p: (0, p) if p.lower().endswith((".glb", ".gltf"))
               else (1, p) if p.lower().endswith(".obj") else (2, p))
    return found[:MAX_MODELS_PER_PACK]

def import_model(path):
    lower = path.lower()
    before = set(bpy.data.objects)
    if lower.endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=path)
    elif lower.endswith(".obj"):
        bpy.ops.wm.obj_import(filepath=path)
    elif lower.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    new = set(bpy.data.objects) - before
    return new

def label_name(path, pack_name):
    base = os.path.splitext(os.path.basename(path))[0]
    base = base.replace("_", " ").replace("-", " ").replace("  ", " ")
    # strip pack prefix repetitions
    words = base.split()
    clean = " ".join(dict.fromkeys(w for w in words if w.lower() not in
                     ("kenney", "kit", "pack", "model", "lowpoly", "3d")))
    return clean if clean else base

def add_label(text, location):
    data = bpy.data.curves.new(f"label_{text[:16]}", type="FONT")
    data.body = text
    data.size = 0.9
    data.align_x = "CENTER"
    data.align_y = "CENTER"
    obj = bpy.data.objects.new(f"label_{text[:20]}", data)
    obj.location = location
    return obj

def add_pack_floor(category_y, pack_y, width):
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.name = f"floor_{category_y}_{pack_y}"
    plane.scale = (width / 2 + 1.5, 3.5, 1)
    plane.location = (0, category_y + pack_y, 0)
    mat = bpy.data.materials.new("floor_mat")
    mat.diffuse_color = (0.08, 0.08, 0.1, 1)
    mat.use_nodes = False
    plane.data.materials.append(mat)
    plane.rotation_euler = (math.radians(90), 0, 0)
    return plane

def main():
    clear_scene()
    cursor_y = 0.0
    total_imported = 0

    for category, packs in CATEGORIES:
        col = ensure_collection(category)
        pack_y = 0.0
        for pack_path in packs:
            pack_dir = os.path.join(LIBRARY, pack_path.replace("/", os.sep))
            if not os.path.isdir(pack_dir):
                continue
            models = pick_models(pack_dir)
            if not models:
                continue
            x = 0.0
            placed = 0
            for path in models:
                new_objs = import_model(path)
                if not new_objs:
                    continue
                # group imported objects, center them
                import mathutils
                group = bpy.data.objects.new(f"item_{placed}", None)
                group.empty_display_type = "PLAIN_AXES"
                col.objects.link(group)
                for obj in new_objs:
                    if obj.name in bpy.context.scene.collection.objects:
                        bpy.context.scene.collection.objects.unlink(obj)
                    col.objects.link(obj)
                    obj.parent = group
                    obj.matrix_parent_inverse = group.matrix_world.inverted()
                bb_min = None
                bb_max = None
                for obj in new_objs:
                    for corner in obj.bound_box:
                        w = obj.matrix_world @ mathutils.Vector(corner)
                        if bb_min is None:
                            bb_min = w.copy()
                            bb_max = w.copy()
                        else:
                            bb_min.x = min(bb_min.x, w.x)
                            bb_min.y = min(bb_min.y, w.y)
                            bb_min.z = min(bb_min.z, w.z)
                            bb_max.x = max(bb_max.x, w.x)
                            bb_max.y = max(bb_max.y, w.y)
                            bb_max.z = max(bb_max.z, w.z)
                if bb_min is None:
                    continue
                center = (bb_min + bb_max) / 2
                size_x = bb_max.x - bb_min.x
                # move group so model sits on floor, centered at x
                group.location = (x - center.x, cursor_y + pack_y - center.y, -bb_min.z)
                # label above
                label = add_label(label_name(path, pack_path), (x, cursor_y + pack_y, LABEL_HEIGHT))
                col.objects.link(label)
                x += SPACING_X + max(size_x, 1.0)
                placed += 1
                total_imported += 1
            if placed:
                add_pack_floor(cursor_y, pack_y, x - SPACING_X)
                pack_y += SPACING_ROW
        cursor_y += pack_y + SPACING_CATEGORY

    # lighting
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 20))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.ops.object.light_add(type="AREA", location=(0, -30, 25))
    bpy.ops.object.light_add(type="AREA", location=(0, 30, 25))
    # camera
    bpy.ops.object.camera_add(location=(0, -35, 18))
    cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(65), 0, 0)
    bpy.context.scene.camera = cam

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print(f"MUSEUM DONE: {total_imported} models imported -> {OUT}")

main()
