"""Retarget the Quaternius 65-joint locomotion clips onto the player (Eric).

Run headless from the repo root:

    python3 scripts/retarget/bake-retarget.py

(Blender 4.2 as a Python module; `bpy` must be importable.)

Writes public/models/characters/player/player-clips.glb: Eric's skeleton, no
meshes, seven clips — Idle_Loop, Walk_Loop, Jog_Fwd_Loop, Sprint_Loop,
Jump_Start, Jump_Loop, Jump_Land.

Why this is not a Copy Rotation bake any more
---------------------------------------------
The first version put world-space COPY_ROTATION constraints on Eric's bones and
baked them. That shipped two faults, both measured on the old GLB:

  1. It deleted the source actions *before* baking ("so the baked clips own the
     names"), so the hero rig had no animation while the bake ran. Every one of
     the seven clips came out as the same constant pose — two keyframes per
     track, identical across clips. The player never animated.
  2. World-space Copy Rotation copies the *absolute* orientation of each source
     bone. The two rigs do not share bone axes (Eric's hip rests at
     (-0.5, -0.5, 0.5, 0.5); the hero's pelvis does not), and it also copied
     the hero root's -90° X onto Eric's `_rootJoint`, so the pose lay flat on
     its back in the street.

This version retargets explicitly, per frame, in world space:

    target_world = source_world · source_rest_world⁻¹ · align · target_rest_world

— the source bone's rotation *away from its rest pose* is applied to the
target's rest pose, after `align` swings the target's rest bone direction onto
the source's (the hero rests in a T-pose, Eric in an A-pose; without it the
arms would hang 45° off). The world pose is then converted back into Blender's
per-bone basis through the rest matrices, keyed, and exported through NLA
tracks. Pelvis translation is carried over, scaled by leg length, with any
horizontal drift removed so every loop stays in place.
"""
import json
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
HERO_URL = os.path.join(HERE, "quaternius-hero.glb")
ERIC_URL = os.path.join(REPO, "public", "models", "characters", "player", "player.glb")
OUT_URL = os.environ.get(
    "RETARGET_OUT",
    os.path.join(REPO, "public", "models", "characters", "player", "player-clips.glb"),
)
MAPPING = json.load(open(os.path.join(HERE, "mapping.json"), "r", encoding="utf-8"))
TARGET_CLIPS = [
    "Idle_Loop",
    "Walk_Loop",
    "Jog_Fwd_Loop",
    "Sprint_Loop",
    "Jump_Start",
    "Jump_Loop",
    "Jump_Land",
]
# The root carries no animation worth copying and its rest axes differ; the
# pelvis owns the body's position instead.
SKIP_SOURCE = {"root"}
# When a bone has several mapped children, which one defines its direction.
PREFERRED_CHILD = {
    "pelvis": "spine_01",
    "spine_03": "neck_01",
    "hand_l": "middle_01_l",
    "hand_r": "middle_01_r",
}

# ── 1. Import both rigs ────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=HERO_URL)
hero_objects = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=ERIC_URL)

armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
hero_arm = next(o for o in armatures if o in hero_objects)
eric_arm = next(o for o in armatures if o not in hero_objects)
print("HERO:", hero_arm.name, "ERIC:", eric_arm.name, flush=True)

mapping = {s: t for s, t in MAPPING.items() if s not in SKIP_SOURCE}
mapping = {
    s: t
    for s, t in mapping.items()
    if hero_arm.data.bones.get(s) is not None and eric_arm.data.bones.get(t) is not None
}
target_to_source = {t: s for s, t in mapping.items()}


def world_rot(arm, matrix):
    return (arm.matrix_world @ matrix).to_3x3().normalized().to_quaternion()


def world_head(arm, bone):
    return arm.matrix_world @ bone.head_local


def rest_direction(arm, bone_name, mapped_names, preferred=None):
    """Rest direction from a bone to its defining mapped child, world space."""
    bone = arm.data.bones[bone_name]
    kids = [c for c in bone.children if c.name in mapped_names]
    if preferred:
        pick = [c for c in kids if c.name == preferred]
        kids = pick or kids
    if not kids:
        return None
    d = world_head(arm, kids[0]) - world_head(arm, bone)
    return d.normalized() if d.length > 1e-9 else None


# ── 2. Rest-pose alignment per mapped bone ─────────────────────────────
source_names = set(mapping.keys())
target_names = set(mapping.values())
align = {}


def order(arm):
    out = []

    def visit(b):
        out.append(b)
        for c in b.children:
            visit(c)

    for b in arm.data.bones:
        if b.parent is None:
            visit(b)
    return out


eric_order = order(eric_arm)
for bone in eric_order:
    t = bone.name
    s = target_to_source.get(t)
    if s is None:
        continue
    preferred_src = PREFERRED_CHILD.get(s)
    preferred_tgt = mapping.get(preferred_src) if preferred_src else None
    ds = rest_direction(hero_arm, s, source_names, preferred_src)
    dt = rest_direction(eric_arm, t, target_names, preferred_tgt)
    if ds is not None and dt is not None:
        align[t] = dt.rotation_difference(ds)
    else:
        # End bones (head, feet tips, finger tips) inherit the parent's swing.
        parent = bone.parent
        while parent is not None and parent.name not in align:
            parent = parent.parent
        align[t] = align[parent.name] if parent is not None else Quaternion()

src_rest = {s: world_rot(hero_arm, hero_arm.data.bones[s].matrix_local) for s in mapping}
tgt_rest = {t: world_rot(eric_arm, eric_arm.data.bones[t].matrix_local) for t in target_names}

pelvis_src = "pelvis"
pelvis_tgt = mapping.get(pelvis_src)
src_pelvis_rest = world_head(hero_arm, hero_arm.data.bones[pelvis_src])
tgt_pelvis_rest = world_head(eric_arm, eric_arm.data.bones[pelvis_tgt])
# Scale translation by hip height, measured from the lowest foot.
src_floor = min(world_head(hero_arm, b).z for b in hero_arm.data.bones)
tgt_floor = min(world_head(eric_arm, b).z for b in eric_arm.data.bones)
translation_scale = (tgt_pelvis_rest.z - tgt_floor) / max(1e-6, src_pelvis_rest.z - src_floor)
print("translation scale", translation_scale, flush=True)

eric_world_inv = eric_arm.matrix_world.inverted()
eric_world_rot_inv = eric_arm.matrix_world.to_3x3().normalized().to_quaternion().inverted()

# ── 3. Bake each clip ──────────────────────────────────────────────────
source_actions = {}
for action in bpy.data.actions:
    for name in TARGET_CLIPS:
        if action.name == f"{name}_{hero_arm.name}" or action.name == name:
            source_actions[name] = action

scene = bpy.context.scene
if hero_arm.animation_data is None:
    hero_arm.animation_data_create()
if eric_arm.animation_data is None:
    eric_arm.animation_data_create()
for pb in eric_arm.pose.bones:
    pb.rotation_mode = "QUATERNION"

baked_names = []
for name in TARGET_CLIPS:
    src_action = source_actions.get(name)
    if src_action is None:
        print("CLIP NOT FOUND", name, flush=True)
        continue
    f0, f1 = int(src_action.frame_range[0]), int(src_action.frame_range[1])
    hero_arm.animation_data.action = src_action

    # Pass 1: pelvis offsets, for drift removal.
    offsets = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        head = hero_arm.matrix_world @ hero_arm.pose.bones[pelvis_src].head
        offsets.append((head - src_pelvis_rest) * translation_scale)
    span = max(1, f1 - f0)
    drift = offsets[-1] - offsets[0]
    drift.z = 0.0  # vertical motion (a crouch, a landing) is the point

    baked = bpy.data.actions.new(name)
    eric_arm.animation_data.action = baked
    previous = {}

    for i, f in enumerate(range(f0, f1 + 1)):
        scene.frame_set(f)
        pose_arm = {}
        for bone in eric_order:
            t = bone.name
            parent = bone.parent
            s = target_to_source.get(t)
            if parent is not None:
                inherited = pose_arm[parent.name] @ parent.matrix_local.inverted() @ bone.matrix_local
            else:
                inherited = bone.matrix_local.copy()
            if s is None:
                pose_arm[t] = inherited
                continue
            src_pb = hero_arm.pose.bones[s]
            rs = world_rot(hero_arm, src_pb.matrix)
            rt_world = rs @ src_rest[s].inverted() @ align[t] @ tgt_rest[t]
            rt_arm = eric_world_rot_inv @ rt_world
            if t == pelvis_tgt:
                offset = offsets[i] - drift * (i / span)
                pos_world = tgt_pelvis_rest + offset
                pos_arm = eric_world_inv @ pos_world
            else:
                pos_arm = inherited.translation
            pose_arm[t] = Matrix.LocRotScale(pos_arm, rt_arm, Vector((1.0, 1.0, 1.0)))

        for bone in eric_order:
            t = bone.name
            if t not in target_to_source:
                continue
            parent = bone.parent
            if parent is not None:
                basis = (
                    bone.matrix_local.inverted()
                    @ parent.matrix_local
                    @ pose_arm[parent.name].inverted()
                    @ pose_arm[t]
                )
            else:
                basis = bone.matrix_local.inverted() @ pose_arm[t]
            q = basis.to_quaternion()
            prev = previous.get(t)
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            previous[t] = q
            pb = eric_arm.pose.bones[t]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if t == pelvis_tgt:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=f)

    baked.use_fake_user = True
    baked_names.append(name)
    print("BAKED", name, f1 - f0 + 1, "frames", flush=True)

# ── 4. Export Eric's skeleton with one NLA track per clip ──────────────
for o in list(bpy.data.objects):
    if o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
bpy.data.objects.remove(hero_arm, do_unlink=True)
for a in list(bpy.data.actions):
    if a.name not in baked_names:
        bpy.data.actions.remove(a)

if not baked_names:
    raise SystemExit("no baked actions to export — refusing to write a T-pose GLB")

eric_arm.animation_data.action = None
for track in list(eric_arm.animation_data.nla_tracks):
    eric_arm.animation_data.nla_tracks.remove(track)
for name in baked_names:
    action = bpy.data.actions[name]
    track = eric_arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(action.frame_range[0]), action)
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
print("EXPORTED", OUT_URL, baked_names, flush=True)
