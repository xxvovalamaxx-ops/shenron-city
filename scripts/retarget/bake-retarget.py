import bpy
import json
import os
import mathutils

BASE = "E:/temp projects/shenron-city"
HERO_URL = "E:/temp projects/shenron-city/scripts/retarget/quaternius-hero.glb"
ERIC_URL = "E:/temp projects/shenron-city/SourceAssets/PublicLibrary/Characters/Sketchfab/Eric_Rigged_Business_Man.glb"
MAPPING = json.load(open(f"{BASE}/scripts/retarget/mapping.json", "r", encoding="utf-8"))
OUT_URL = f"{BASE}/public/models/characters/player/player-clips.glb"
TARGET_CLIPS = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop", "Jump_Start", "Jump_Loop", "Jump_Land"]

# ── 1. Import both rigs ────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HERO_URL)
bpy.ops.import_scene.gltf(filepath=ERIC_URL)

hero_arm = None
eric_arm = None
for o in bpy.data.objects:
    if o.type == "ARMATURE":
        if o.name.lower().startswith("armature") or "hero" in o.name.lower():
            hero_arm = o
        else:
            eric_arm = o
if hero_arm is None:
    hero_arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
if eric_arm is None:
    eric_arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][-1]
print("HERO:", hero_arm.name, "ERIC:", eric_arm.name, flush=True)

# Eric meshes are in cm scale; scale armature+meshes to metres so exported
# bones sit at metre positions (rotations are unaffected by scale anyway).
bpy.ops.object.select_all(action="DESELECT")
for o in list(bpy.data.objects):
    o.select_set(o.name in (eric_arm.name,) or (o.parent == eric_arm))
bpy.context.view_layer.objects.active = eric_arm
bpy.ops.object.parent_set(type="OBJECT", keep_transform=False)
bpy.ops.object.mode_set(mode="OBJECT")
for o in list(bpy.data.objects):
    if o.parent == eric_arm or o.name == eric_arm.name:
        o.select_set(True)
bpy.context.view_layer.objects.active = eric_arm
bpy.ops.object.transform_apply(scale=True)
eric_arm.scale = (0.01, 0.01, 0.01)
bpy.context.view_layer.update()

# ── 2. World-space CopyRotation constraints, baked ─────────────────────
for src, tgt in MAPPING.items():
    sb = hero_arm.pose.bones.get(src)
    tb = eric_arm.pose.bones.get(tgt)
    if sb is None or tb is None:
        print("MISSING", src, "->", tgt, flush=True)
        continue
    c = tb.constraints.new("COPY_ROTATION")
    c.target = hero_arm
    c.subtarget = src
    c.target_space = "WORLD"
    c.owner_space = "WORLD"
    c.mix_mode = "REPLACE"

# ── 2b. Record source clip ranges, then delete source actions so the
#        baked clips own the names. ─────────────────────────────────────
source_actions = {}
for a in bpy.data.actions:
    if a.frame_range and (a.frame_range[1] - a.frame_range[0]) > 1:
        source_actions[a.name] = (int(a.frame_range[0]), int(a.frame_range[1]))
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

for name in TARGET_CLIPS:
    if name not in source_actions:
        print("CLIP NOT FOUND", name, list(source_actions.keys()), flush=True)
        continue
    f0, f1 = source_actions[name]
    # Remove any existing action on Eric, then bake into a fresh one.
    eric_arm.animation_data_clear()
    eric_arm.animation_data_create()
    bpy.context.scene.frame_start = f0
    bpy.context.scene.frame_end = f1
    bpy.context.scene.frame_set(f0)
    bpy.ops.nla.bake(
        frame_start=f0,
        frame_end=f1,
        step=1,
        only_selected=False,
        visual_keying=True,
        clear_constraints=True,
        clear_parents=False,
        use_current_action=True,
        bake_types={"POSE"},
    )
    baked = eric_arm.animation_data.action
    if baked is not None:
        baked.name = name
        print("BAKED", name, int(baked.frame_range[1] - baked.frame_range[0]), flush=True)

# ── 4. Remove meshes so the clips GLB is tiny; export armature ─────────
for o in list(bpy.data.objects):
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# And remove the source rig. Leaving it in exported its own 22 unretargeted
# clips alongside the 7 baked ones — same names, different skeleton, 1.1 MB
# instead of 0.2 MB, and a runtime that could pick the wrong one by name.
bpy.data.objects.remove(hero_arm, do_unlink=True)

# Do NOT clear animation_data here.
#
# export_animation_mode="ACTIONS" works by assigning each action to the object
# in turn and sampling it, so it needs animation_data to assign *to*. Clearing
# it first left the exporter with nothing to attach and it wrote a GLB with the
# skeleton and zero animations — which is exactly what shipped: the runtime's
# clip map came up empty, no action ever played, and the player stood in the
# street in his bind pose. Keep the action block alive and keep a fake user on
# each baked clip so none of them is garbage-collected before export.
for a in bpy.data.actions:
    a.use_fake_user = False
baked_names = []
for name in TARGET_CLIPS:
    if name in bpy.data.actions:
        bpy.data.actions[name].use_fake_user = True
        baked_names.append(name)
print("TO EXPORT:", baked_names, flush=True)
if not baked_names:
    raise SystemExit("no baked actions to export — refusing to write a T-pose GLB")

# One NLA track per clip, and export by track.
#
# "ACTIONS" mode looked like the obvious choice and is not: since Blender's
# slotted-action rework the exporter only emits the action actually assigned to
# the armature, so a run that baked all seven clips shipped exactly one
# (Idle_Loop, 267 channels — measured). NLA tracks are explicit: one track in,
# one glTF animation out, named after the track.
if eric_arm.animation_data is None:
    eric_arm.animation_data_create()
eric_arm.animation_data.action = None
for track in list(eric_arm.animation_data.nla_tracks):
    eric_arm.animation_data.nla_tracks.remove(track)
for name in baked_names:
    action = bpy.data.actions[name]
    track = eric_arm.animation_data.nla_tracks.new()
    track.name = name
    start = int(action.frame_range[0])
    strip = track.strips.new(name, start, action)
    strip.name = name

os.makedirs(os.path.dirname(OUT_URL), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT_URL,
    export_format="GLB",
    use_selection=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_materials="NONE",
    export_apply=False,
    export_yup=True,
)
print("EXPORTED", OUT_URL, flush=True)
for a in bpy.data.actions:
    print("ACTION:", a.name, flush=True)
print("DONE", flush=True)
