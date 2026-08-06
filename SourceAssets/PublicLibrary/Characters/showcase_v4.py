"""
Character Library Showcase v4 — world-space bbox, armature-aware.
"""
import bpy
import os
import math
from mathutils import Vector

OUTPUT_DIR = r"E:\temp projects\shenron-city\SourceAssets\PublicLibrary\Characters"
RENDER_PATH = os.path.join(OUTPUT_DIR, "character_showcase.png")
CHAR_ROOT = r"E:\temp projects\shenron-city\SourceAssets\PublicLibrary\Characters"

COLS = 8
SPACING_X = 3.0
SPACING_Y = 4.0
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

print(f"[showcase] {len(characters)} characters")

# ── Clear ────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for bc in [bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
            bpy.data.actions, bpy.data.cameras, bpy.data.lights,
            bpy.data.curves, bpy.data.fonts]:
    for b in list(bc):
        bc.remove(b)

# ── Import helper ────────────────────────────────────────────────────
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

def world_bbox(objs):
    """Get world-space bounding box for a set of objects, including child meshes."""
    mn = Vector((float('inf'), float('inf'), float('inf')))
    mx = Vector((float('-inf'), float('-inf'), float('-inf')))
    found = False
    for o in objs:
        if o.type == 'MESH':
            mesh = o.data
            if not mesh or not mesh.polygons:
                continue
            mat = o.matrix_world
            for v in mesh.vertices:
                co = mat @ v.co
                for i in range(3):
                    mn[i] = min(mn[i], co[i])
                    mx[i] = max(mx[i], co[i])
                found = True
        elif o.type == 'ARMATURE':
            # For armatures, get bounds from child meshes
            for child in o.children:
                if child.type == 'MESH' and child.data and child.data.polygons:
                    mat = child.matrix_world
                    for v in child.data.vertices:
                        co = mat @ v.co
                        for i in range(3):
                            mn[i] = min(mn[i], co[i])
                            mx[i] = max(mx[i], co[i])
                        found = True
    if not found:
        return None, None
    return mn, mx

# ── Import each character ────────────────────────────────────────────
total_rows = math.ceil(len(characters) / COLS)

for idx, (name, fp) in enumerate(characters):
    print(f"  [{idx+1}/{len(characters)}] {name}")
    objs = import_file(fp)
    if not objs:
        continue

    bpy.context.view_layer.update()

    # Get world-space bounds (before any transforms)
    mn, mx = world_bbox(objs)
    if mn is None:
        print(f"  SKIP {name}: no mesh data")
        continue

    h = mx.z - mn.z
    cx = (mn.x + mx.x) / 2
    cy = (mn.y + mx.y) / 2
    bottom = mn.z

    if h < 0.01:
        print(f"  SKIP {name}: height={h}")
        continue

    # Scale factor
    s = TARGET_CHAR_HEIGHT / h

    # Grid position
    row = idx // COLS
    col = idx % COLS
    gx = col * SPACING_X
    gy = -row * SPACING_Y

    # Move all objects: center horizontally, ground vertically, place at grid
    for o in objs:
        o.location.x += (gx - cx * s) - o.location.x * (1 - s)
        o.location.y += (gy - cy * s) - o.location.y * (1 - s)
        o.location.z += (-bottom * s) - o.location.z * (1 - s)
        o.scale = (s, s, s)

    # Recalculate after scale
    bpy.context.view_layer.update()

    # Add label
    crv = bpy.data.curves.new(f"lbl_{name[:20]}", 'FONT')
    crv.body = name
    crv.size = 0.25
    crv.align_x = 'CENTER'
    crv.align_y = 'CENTER'
    crv.resolution_u = 3
    mat = bpy.data.materials.new(f"m_{name[:15]}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.9, 0.95, 1, 1)
        bsdf.inputs['Emission Color'].default_value = (0.6, 0.7, 1, 1)
        bsdf.inputs['Emission Strength'].default_value = 5.0
    crv.materials.append(mat)
    lbl = bpy.data.objects.new(f"lbl_{name[:20]}", crv)
    bpy.context.collection.objects.link(lbl)
    lbl.location = (gx, gy, TARGET_CHAR_HEIGHT + 0.35)
    lbl.rotation_euler = (math.radians(90), 0, 0)

print(f"[showcase] Placed characters")

# ── Ground plane ─────────────────────────────────────────────────────
grid_w = (COLS - 1) * SPACING_X
grid_h = (total_rows - 1) * SPACING_Y
gcx = grid_w / 2
gcy = -grid_h / 2

gw = COLS * SPACING_X + 4
gh = total_rows * SPACING_Y + 4
bpy.ops.mesh.primitive_plane_add(size=1, location=(gcx, gcy, -0.01))
gnd = bpy.context.active_object
gnd.scale = (gw / 2, gh / 2, 1)
gnd.name = "Ground"
mg = bpy.data.materials.new("ground_mat")
mg.use_nodes = True
b = mg.node_tree.nodes.get("Principled BSDF")
if b:
    b.inputs['Base Color'].default_value = (0.08, 0.08, 0.1, 1)
    b.inputs['Roughness'].default_value = 0.9
gnd.data.materials.append(mg)

# ── Lighting ──────────────────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(gcx, gcy, 20))
sun = bpy.context.active_object
sun.name = "Sun"
sun.data.energy = 5.0
sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))

bpy.ops.object.light_add(type='AREA', location=(gcx, gcy - 20, 12))
fl = bpy.context.active_object
fl.name = "FrontFill"
fl.data.energy = 5000
fl.data.size = 30
fl.rotation_euler = (math.radians(30), 0, 0)

bpy.ops.object.light_add(type='AREA', location=(gcx, gcy + 20, 10))
rl = bpy.context.active_object
rl.name = "BackRim"
rl.data.energy = 800
rl.data.size = 20
rl.rotation_euler = (math.radians(35), 0, math.radians(180))

# ── Camera — orthographic ────────────────────────────────────────────
cam_x = gcx
cam_y = gcy - 30
cam_z = grid_h / 2 + 2

bpy.ops.object.camera_add(location=(cam_x, cam_y, cam_z))
cam = bpy.context.active_object
cam.name = "Camera"
cam.data.type = 'ORTHO'
cam.data.ortho_scale = max(gw, gh) + 2
bpy.context.scene.camera = cam

target = Vector((gcx, gcy, TARGET_CHAR_HEIGHT))
direction = (target - cam.location).normalized()
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

print(f"[showcase] Camera ortho_scale={cam.data.ortho_scale:.1f}")

# ── World ────────────────────────────────────────────────────────────
world = bpy.context.scene.world or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs['Color'].default_value = (0.1, 0.1, 0.12, 1)
    bg.inputs['Strength'].default_value = 2.0

# ── Render ───────────────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.resolution_x = 3840
scene.render.resolution_y = 2160
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = RENDER_PATH

blend_path = os.path.join(OUTPUT_DIR, "character_showcase.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"[showcase] Saved {blend_path}")

bpy.ops.render.render(write_still=True)
print(f"[showcase] Render done: {RENDER_PATH}")
