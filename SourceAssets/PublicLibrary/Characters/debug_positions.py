"""Debug: dump character positions after import and grid placement."""
import bpy
import os
import math
from mathutils import Vector

CHAR_ROOT = r"E:\temp projects\shenron-city\SourceAssets\PublicLibrary\Characters"
COLS = 8
SPACING_X = 3.0
SPACING_Y = 3.5
TARGET_CHAR_HEIGHT = 1.7

characters = []
sketchfab_dir = os.path.join(CHAR_ROOT, "Sketchfab")
for f in sorted(os.listdir(sketchfab_dir)):
    if f.lower().endswith(".glb"):
        characters.append((os.path.splitext(f)[0], os.path.join(sketchfab_dir, f)))

rp_glb = os.path.join(CHAR_ROOT, "Renderpeople", "posed_new", "rp_posed_00178_29.glb")
if os.path.isfile(rp_glb):
    characters.append(("RP Posed 00178", rp_glb))

for person in ["rp_carla_rigged_001", "rp_claudia_rigged_002", "rp_eric_rigged_001"]:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "rigged", f"{person}_FBX", f"{person}_yup_a.fbx")
    if os.path.isfile(fbx):
        characters.append((person.split("_")[1].capitalize(), fbx))

for person, anim in [("sophia", "idling"), ("nathan", "walking"), ("manuel", "dancing")]:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "animated",
                        f"rp_{person}_animated_003_{anim}_FBX", f"rp_{person}_animated_003_{anim}.fbx")
    if os.path.isfile(fbx):
        characters.append((f"RP {person.capitalize()}", fbx))

rp_classic = [
    ("Dennis", "rp_dennis_posed_004_OBJ", "rp_dennis_posed_004_100k.fbx"),
    ("Mei", "rp_mei_posed_001_OBJ", "rp_mei_posed_001_100k.fbx"),
    ("Fabienne", "rp_fabienne_percy_posed_001_OBJ", "rp_fabienne_percy_posed_001_200k.fbx"),
]
for label, folder, fname in rp_classic:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "posed_classic", folder, fname)
    if os.path.isfile(fbx):
        characters.append((f"RP {label}", fbx))

MIXAMO = ["Alex", "Amy", "Brady", "Claire", "Elizabeth", "Gas Mask", "Jennifer",
          "Jones", "Kate", "Leonard", "Martha", "Olivia", "Pete",
          "Racer", "Steve", "Swat", "The Boss", "Zlorp", "Y Bot"]
for name in MIXAMO:
    fbx = os.path.join(CHAR_ROOT, "Mixamo", f"{name}.fbx")
    if os.path.isfile(fbx):
        characters.append((name, fbx))

print(f"[debug] {len(characters)} characters to import")

# Clear
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for bc in [bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
            bpy.data.actions, bpy.data.cameras, bpy.data.lights,
            bpy.data.curves, bpy.data.fonts]:
    for b in list(bc):
        bc.remove(b)

def import_file(fp):
    ext = os.path.splitext(fp)[1].lower()
    before = set(bpy.context.scene.objects)
    try:
        if ext == ".glb":
            bpy.ops.import_scene.gltf(filepath=fp)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=fp, automatic_bone_orientation=True)
    except Exception as e:
        print(f"  FAIL {os.path.basename(fp)}: {e}")
        return []
    return [o for o in bpy.context.scene.objects if o not in before]

def get_bbox(objs):
    mn = Vector((float('inf'), float('inf'), float('inf')))
    mx = Vector((float('-inf'), float('-inf'), float('-inf')))
    for o in objs:
        if o.type in {'MESH', 'ARMATURE'}:
            for c in o.bound_box:
                v = o.matrix_world @ Vector(c)
                for i in range(3):
                    mn[i] = min(mn[i], v[i])
                    mx[i] = max(mx[i], v[i])
    return mn, mx

# Import first 3 characters and dump their bbox
for i, (name, fp) in enumerate(characters[:3]):
    objs = import_file(fp)
    if not objs:
        continue
    bpy.context.view_layer.update()
    mn, mx = get_bbox(objs)
    h = mx.z - mn.z
    print(f"\n[debug] {name}:")
    print(f"  objects: {[o.name for o in objs]}")
    print(f"  bbox min=({mn.x:.3f}, {mn.y:.3f}, {mn.z:.3f}) max=({mx.x:.3f}, {mx.y:.3f}, {mx.z:.3f})")
    print(f"  height={h:.3f}")
    for o in objs:
        print(f"  {o.name}: loc=({o.location.x:.3f}, {o.location.y:.3f}, {o.location.z:.3f}) scale=({o.scale.x:.3f}, {o.scale.y:.3f}, {o.scale.z:.3f})")

result = {"status": "debug done"}
