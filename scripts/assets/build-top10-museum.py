"""
Build per-category Top-10 showcase files for the public library.

For each category this creates one Blender file:
  SourceAssets/Museum/Top10_<Category>.blend
containing the 10 most detailed assets of that category, one row, each with
its name floating above, own lighting, camera, and floor.

"Top 10" = the 10 largest (most detailed) 3D files, deduplicated by stem.
VFX shows the 10 largest 2D sprites as textured planes.

Run headless:
  blender --background --python scripts/assets/build-top10-museum.py
"""
import bpy
import os
import math

LIBRARY = "SourceAssets/PublicLibrary"
OUT_DIR = "SourceAssets/Museum"

CATEGORIES = [
    {
        "file": "Top10_Buildings",
        "packs": ["Buildings/City", "Buildings/Modular"],
        "kind": "3d",
        "max": 10,
    },
    {
        "file": "Top10_Vehicles",
        "packs": ["Vehicles/Cars", "Kenney/kenney-train-kit", "Kenney/kenney-watercraft-kit"],
        "kind": "3d",
        "max": 10,
    },
    {
        "file": "Top10_Characters",
        "packs": ["Characters/Animated"],
        "kind": "3d",
        "max": 10,
    },
    {
        "file": "Top10_Nature",
        "packs": ["Environment/Nature"],
        "kind": "3d",
        "max": 10,
    },
    {
        "file": "Top10_VFX",
        "packs": ["VFX"],
        "kind": "sprite",
        "max": 10,
    },
    {
        "file": "Top10_Props",
        "packs": ["Props/Quaternius", "Props/Market", "Props/Interior", "Props/Prototype"],
        "kind": "3d",
        "max": 10,
    },
]

MODEL_EXTENSIONS = (".glb", ".gltf", ".obj")
SPRITE_EXTENSIONS = (".png", ".jpg")
EXCLUDE_PARTS = ("floor-panel", "pipe-", "rail-", "wall-corner", "structure-",
                 "tower-middle", "tower-top", "tower-roof", "tower-base",
                 "mast-", "flag-", "patch-", "grass-", "rocks", "rock-",
                 "road", "street-", "sign-", "sidewalk")

def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    # reset to default collection only
    if bpy.context.scene.collection.children:
        for child in list(bpy.context.scene.collection.children):
            bpy.context.scene.collection.children.unlink(child)

def collect_files(packs, extensions):
    found = []
    for pack in packs:
        pack_dir = os.path.join(LIBRARY, pack.replace("/", os.sep))
        if not os.path.isdir(pack_dir):
            continue
        for root, _dirs, files in os.walk(pack_dir):
            for name in files:
                if not name.lower().endswith(extensions):
                    continue
                base = name.lower()
                if any(ex in base for ex in EXCLUDE_PARTS):
                    continue
                path = os.path.join(root, name)
                found.append((os.path.getsize(path), path, name))
    return found

def dedupe_by_stem(files):
    """Largest per unique stem (ignore .001/.002 and extension)."""
    best = {}
    for size, path, name in sorted(files, key=lambda f: -f[0]):
        stem = os.path.splitext(name)[0]
        stem = stem.split(".")[0]
        stem = stem.replace("_", " ").replace("-", " ").lower().strip()
        if stem not in best:
            best[stem] = (size, path, name)
    return [best[k] for k in best]

def label_name(name):
    base = os.path.splitext(name)[0]
    base = base.split(".")[0]
    words = base.replace("_", " ").replace("-", " ").split()
    clean = " ".join(dict.fromkeys(w for w in words if w.lower() not in
                     ("kenney", "kit", "pack", "model", "lowpoly", "3d", "animated")))
    return clean if clean else base

def add_label(text, location):
    data = bpy.data.curves.new(f"label_{text[:14]}", type="FONT")
    data.body = text
    data.size = 1.1
    data.align_x = "CENTER"
    data.align_y = "CENTER"
    obj = bpy.data.objects.new(f"label_{text[:20]}", data)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj

def setup_scene(title):
    world = bpy.data.worlds.new(f"World_{title}")
    world.use_nodes = True
    bsdf = world.node_tree.nodes.get("Background")
    if bsdf:
        bsdf.inputs[0].default_value = (0.02, 0.02, 0.03, 1)
    bpy.context.scene.world = world
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 20))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.ops.object.light_add(type="AREA", location=(0, -15, 12))
    bpy.ops.object.light_add(type="AREA", location=(0, 15, 12))

def add_floor(width):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, -0.02))
    ground = bpy.context.active_object
    ground.name = "Floor"
    ground.scale = (width / 2 + 1.5, 3.5, 1)
    mat = bpy.data.materials.new("floor_mat")
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get("Principled BSDF")
    if bs:
        bs.inputs["Base Color"].default_value = (0.05, 0.05, 0.06, 1)
        bs.inputs["Roughness"].default_value = 0.9
    ground.data.materials.append(mat)
    return ground

def place_item(objs, x, y, label, kind):
    import mathutils
    bb_min = None
    bb_max = None
    for obj in objs:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            if bb_min is None:
                bb_min = w.copy()
                bb_max = w.copy()
            else:
                for i in range(3):
                    bb_min[i] = min(bb_min[i], w[i])
                    bb_max[i] = max(bb_max[i], w[i])
    if bb_min is None:
        return 2.0
    center = (bb_min + bb_max) / 2
    size_x = bb_max.x - bb_min.x
    for obj in objs:
        obj.location.x -= center.x
        obj.location.y -= center.y
        obj.location.z -= bb_min.z
    for obj in objs:
        obj.location.x += x
        obj.location.y += y
    label_obj = add_label(label, (x, y, 3.4))
    return 3.0 + max(size_x, 1.0)

def build_category(cat):
    print(f"--- {cat['file']} ---")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.object.delete(confirm=False)
    clear_scene()

    ext = MODEL_EXTENSIONS if cat["kind"] == "3d" else SPRITE_EXTENSIONS
    files = collect_files(cat["packs"], ext)
    picks = dedupe_by_stem(files)[: cat["max"]]
    print(f"  candidates {len(files)} -> picked {len(picks)}")

    x = 0.0
    imported_count = 0
    for size, path, name in picks:
        before = set(bpy.data.objects)
        lower = path.lower()
        if lower.endswith((".glb", ".gltf")):
            bpy.ops.import_scene.gltf(filepath=path)
        elif lower.endswith(".obj"):
            bpy.ops.wm.obj_import(filepath=path)
        else:
            # sprite: plane + texture
            if not os.path.exists(path):
                print(f"  skip missing {path}")
                continue
            try:
                img = bpy.data.images.load(os.path.abspath(path))
            except Exception as e:
                print(f"  skip unloadable {path}: {e}")
                continue
            bpy.ops.mesh.primitive_plane_add(size=1)
            plane = bpy.context.active_object
            mat = bpy.data.materials.new(f"mat_{name[:20]}")
            mat.use_nodes = True
            bs = mat.node_tree.nodes.get("Principled BSDF")
            if bs:
                bs.inputs["Base Color"].default_value = (1, 1, 1, 1)
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = img
            mat.node_tree.links.new(tex.outputs["Color"], bs.inputs["Base Color"])
            plane.data.materials.append(mat)
            # size to aspect
            ar = img.size[0] / max(img.size[1], 1)
            plane.scale = (1.5 * ar, 1.5, 1)
            label_obj = add_label(label_name(name), (x, 0, 3.4))
            plane.location = (x, 0, 1.0)
            x += 3.0 + 1.5 * ar
            imported_count += 1
            continue

        new_objs = set(bpy.data.objects) - before
        if not new_objs:
            continue
        x += place_item(list(new_objs), x, 0, label_name(name), cat["kind"])
        imported_count += 1

    if imported_count == 0:
        print("  nothing imported, skipping")
        return
    add_floor(x - 3.0)
    setup_scene(cat["file"])
    bpy.ops.object.camera_add(location=(0, -16, 9))
    cam = bpy.context.active_object
    cam.rotation_euler = (math.radians(55), 0, 0)
    bpy.context.scene.camera = cam

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{cat['file']}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out_path)
    print(f"  SAVED {out_path} ({imported_count} items)")

for cat in CATEGORIES:
    build_category(cat)

print("ALL TOP-10 FILES DONE")
