"""
Character Library Showcase — Blender batch importer.
Imports all Sketchfab GLBs, Renderpeople GLB, and selected Mixamo FBX
characters, arranges them in a grid with filename labels, and renders
a preview image.

Run: blender --background --python showcase_characters.py
"""
import bpy
import os
import math
import sys
from mathutils import Vector

# ── Configuration ────────────────────────────────────────────────────
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
RENDER_PATH = os.path.join(OUTPUT_DIR, "character_showcase.png")

# Grid layout
COLS = 8
SPACING_X = 2.5          # metres between character centres
SPACING_Y = 3.5          # metres between rows
LABEL_HEIGHT = 2.0       # metres above character feet
TARGET_CHAR_HEIGHT = 1.7  # normalise all characters to this height

# Character root (absolute path)
CHAR_ROOT = r"E:\temp projects\shenron-city\SourceAssets\PublicLibrary\Characters"

# ── Collect files ────────────────────────────────────────────────────
characters = []  # list of (display_name, filepath)

# 1) Sketchfab GLBs
sketchfab_dir = os.path.join(CHAR_ROOT, "Sketchfab")
if os.path.isdir(sketchfab_dir):
    for f in sorted(os.listdir(sketchfab_dir)):
        if f.lower().endswith(".glb"):
            name = os.path.splitext(f)[0]
            characters.append((name, os.path.join(sketchfab_dir, f)))

# 2) Renderpeople posed_new GLB
rp_glb = os.path.join(CHAR_ROOT, "Renderpeople", "posed_new", "rp_posed_00178_29.glb")
if os.path.isfile(rp_glb):
    characters.append(("RP Posed 00178", rp_glb))

# 3) Renderpeople rigged — one yup_a per person
for person in ["rp_carla_rigged_001", "rp_claudia_rigged_002", "rp_eric_rigged_001"]:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "rigged",
                        f"{person}_FBX", f"{person}_yup_a.fbx")
    if os.path.isfile(fbx):
        label = person.split("_")[1].capitalize()  # Carla / Claudia / Eric
        characters.append((f"RP {label}", fbx))

# 4) Renderpeople animated — one per person
for person, anim in [("sophia", "idling"), ("nathan", "walking"), ("manuel", "dancing")]:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "animated",
                        f"rp_{person}_animated_003_{anim}_FBX",
                        f"rp_{person}_animated_003_{anim}.fbx")
    if os.path.isfile(fbx):
        characters.append((f"RP {person.capitalize()}", fbx))

# 5) Renderpeople posed classic — highest LOD per person
for person, files in [
    ("Dennis", "rp_dennis_posed_004_100k.fbx"),
    ("Fabienne&Percy", "rp_fabienne_percy_posed_001_200k.fbx"),
    ("Mei", "rp_mei_posed_001_100k.fbx"),
]:
    fbx = os.path.join(CHAR_ROOT, "Renderpeople", "posed_classic",
                        f"rp_{person.split('&')[0].lower()}_posed_004_OBJ"
                        if "&" not in person else
                        f"rp_fabienne_percy_posed_001_OBJ",
                        files)
    if os.path.isfile(fbx):
        characters.append((f"RP {person}", fbx))

# 6) Selected Mixamo — curated 20 characters for showcase
MIXAMO_PICKS = [
    "Alex", "Amy", "Brady", "Claire", "Elizabeth",
    "Gas Mask", "Jennifer", "Jones", "Kate", "Leonard",
    "Martha", "Ninja", "Olivia", "Pete", "Racer",
    "Steve", "Swat", "The Boss", "Zlorp", "Y Bot",
]
mixamo_dir = os.path.join(CHAR_ROOT, "Mixamo")
for name in MIXAMO_PICKS:
    fbx = os.path.join(mixamo_dir, f"{name}.fbx")
    if os.path.isfile(fbx):
        characters.append((name, fbx))

print(f"[showcase] Found {len(characters)} characters to import")

# ── Clear scene ──────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block_coll in [bpy.data.meshes, bpy.data.materials, bpy.data.textures,
                    bpy.data.armatures, bpy.data.actions, bpy.data.cameras,
                    bpy.data.lights, bpy.data.curves, bpy.data.fonts]:
    for block in block_coll:
        block_coll.remove(block)


# ── Helper: import a file ───────────────────────────────────────────
def import_file(filepath):
    """Import a GLB or FBX and return the imported root objects."""
    ext = os.path.splitext(filepath)[1].lower()
    before_meshes = set(bpy.data.meshes)
    before_objects = set(bpy.context.scene.objects)

    try:
        if ext == ".glb":
            bpy.ops.import_scene.gltf(filepath=filepath)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=filepath, automatic_bone_orientation=True)
        else:
            return []
    except Exception as e:
        print(f"  [WARN] Failed to import {os.path.basename(filepath)}: {e}")
        return []

    new_objects = [o for o in bpy.context.scene.objects if o not in before_objects]
    return new_objects


# ── Helper: get bounding box dimensions ──────────────────────────────
def get_character_height(objects):
    """Return the Z-height of the bounding box of given objects."""
    min_z = float('inf')
    max_z = float('-inf')
    for obj in objects:
        if obj.type in {'MESH', 'ARMATURE'}:
            bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
            for v in bbox:
                min_z = min(min_z, v.z)
                max_z = max(max_z, v.z)
    return max_z - min_z if max_z > min_z else 1.0


def get_character_bottom(objects):
    """Return the lowest Z of the bounding box."""
    min_z = float('inf')
    for obj in objects:
        if obj.type in {'MESH', 'ARMATURE'}:
            bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
            for v in bbox:
                min_z = min(min_z, v.z)
    return min_z if min_z != float('inf') else 0.0


def move_to_ground(objects, target_z=0.0):
    """Move objects so their bottom sits at target_z."""
    bottom = get_character_bottom(objects)
    delta_z = target_z - bottom
    for obj in objects:
        obj.location.z += delta_z


# ── Helper: add text label ───────────────────────────────────────────
def add_text_label(text, position, height=0.35):
    """Add a text object at the given world position."""
    curve = bpy.data.curves.new(name=f"label_{text}", type='FONT')
    curve.body = text
    curve.size = height
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.resolution_u = 4

    # White material
    mat = bpy.data.materials.new(name=f"mat_label_{text}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
        bsdf.inputs['Emission Color'].default_value = (0.8, 0.85, 1.0, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    curve.materials.append(mat)

    obj = bpy.data.objects.new(f"label_{text}", curve)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (math.radians(90), 0, 0)
    return obj


# ── Helper: find a free font ────────────────────────────────────────
def find_font():
    """Try to find a usable .ttf or .otf font."""
    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


# ── Import all characters ────────────────────────────────────────────
imported_groups = []  # list of (label, [objects])

for i, (name, filepath) in enumerate(characters):
    print(f"  [{i+1}/{len(characters)}] Importing: {name}")
    objs = import_file(filepath)
    if not objs:
        continue

    # Scale to target height
    h = get_character_height(objs)
    if h > 0.01:
        scale_factor = TARGET_CHAR_HEIGHT / h
        for obj in objs:
            obj.scale = (scale_factor, scale_factor, scale_factor)

    # Recompute after scale
    bpy.context.view_layer.update()

    # Move to ground
    move_to_ground(objs, target_z=0.0)

    imported_groups.append((name, objs))

print(f"[showcase] Successfully imported {len(imported_groups)} characters")

# ── Position in grid ─────────────────────────────────────────────────
for idx, (name, objs) in enumerate(imported_groups):
    row = idx // COLS
    col = idx % COLS
    x = col * SPACING_X
    y = -row * SPACING_Y

    for obj in objs:
        obj.location.x += x
        obj.location.y += y

    # Add label
    h = get_character_height(objs)
    label_z = h + 0.15
    add_text_label(name, Vector((x, y, label_z)), height=0.25)

# ── Ground plane ─────────────────────────────────────────────────────
total_rows = math.ceil(len(imported_groups) / COLS)
plane_size_x = COLS * SPACING_X + 2
plane_size_y = total_rows * SPACING_Y + 2
bpy.ops.mesh.primitive_plane_add(size=1, location=(plane_size_x/2 - SPACING_X/2,
                                                     -plane_size_y/2 + SPACING_Y/2,
                                                     -0.01))
ground = bpy.context.active_object
ground.scale = (plane_size_x / 2, plane_size_y / 2, 1)
ground.name = "Ground"

# Ground material — dark grey
mat_ground = bpy.data.materials.new(name="mat_ground")
mat_ground.use_nodes = True
bsdf = mat_ground.node_tree.nodes.get("Principled BSDF")
if bsdf:
    bsdf.inputs['Base Color'].default_value = (0.15, 0.15, 0.18, 1)
    bsdf.inputs['Roughness'].default_value = 0.8
ground.data.materials.append(mat_ground)

# ── Lighting ─────────────────────────────────────────────────────────
# Key light
bpy.ops.object.light_add(type='AREA', location=(plane_size_x/2, -plane_size_y/2, 8))
key = bpy.context.active_object
key.name = "Key Light"
key.data.energy = 800
key.data.size = 6
key.rotation_euler = (math.radians(30), 0, math.radians(45))

# Fill light
bpy.ops.object.light_add(type='AREA', location=(-plane_size_x/2, plane_size_y/2, 6))
fill = bpy.context.active_object
fill.name = "Fill Light"
fill.data.energy = 300
fill.data.size = 8
fill.rotation_euler = (math.radians(25), 0, math.radians(-30))

# Rim light
bpy.ops.object.light_add(type='AREA', location=(plane_size_x/2, plane_size_y/2, 5))
rim = bpy.context.active_object
rim.name = "Rim Light"
rim.data.energy = 200
rim.data.size = 4
rim.rotation_euler = (math.radians(45), 0, math.radians(180))

# ── Camera ───────────────────────────────────────────────────────────
cam_x = plane_size_x / 2 - SPACING_X / 2
cam_y = -total_rows * SPACING_Y / 2
cam_z = max(4, total_rows * 0.8)

bpy.ops.object.camera_add(location=(cam_x, cam_y - 12, cam_z))
cam = bpy.context.active_object
cam.name = "Showcase Camera"
bpy.context.scene.camera = cam

# Point camera at centre of grid
target_point = Vector((cam_x, -total_rows * SPACING_Y / 2 + SPACING_Y, 1.0))
direction = target_point - cam.location
rot_quat = direction.to_track_quat('-Z', 'Y')
cam.rotation_euler = rot_quat.to_euler()

# ── World / environment ──────────────────────────────────────────────
world = bpy.context.scene.world
if not world:
    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs['Color'].default_value = (0.04, 0.04, 0.06, 1)
    bg.inputs['Strength'].default_value = 0.5

# ── Render settings ──────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 3840
scene.render.resolution_y = 2160
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = RENDER_PATH

# Use GPU if available
prefs = bpy.context.preferences.addons.get('cycles')
if prefs:
    prefs.preferences.compute_device_type = 'CUDA'
    scene.cycles.device = 'GPU'

# ── Save .blend ──────────────────────────────────────────────────────
blend_path = os.path.join(OUTPUT_DIR, "character_showcase.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print(f"[showcase] Saved: {blend_path}")

# ── Render ───────────────────────────────────────────────────────────
print(f"[showcase] Rendering to {RENDER_PATH} ...")
bpy.ops.render.render(write_still=True)
print(f"[showcase] Done! Render saved to: {RENDER_PATH}")
