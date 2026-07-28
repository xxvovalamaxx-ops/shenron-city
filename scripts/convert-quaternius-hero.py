"""Build a web-ready Quaternius hero with a curated CC0 motion library.

Run with Blender:

    blender --background --factory-startup --python scripts/convert-quaternius-hero.py -- \
      RIGGED_CHARACTER.gltf UAL1_STANDARD.glb UAL2_STANDARD.glb OUTPUT.glb

The three inputs use Quaternius' identical 65-joint humanoid hierarchy. The
reviewed runtime build uses the Male Ranger from Modular Character Outfits
Fantasy. Source archives remain in the ignored authoring workspace; only the
implemented, size-bounded runtime export is promoted to public/.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Vector


CLIPS = (
    "Chest_Open",
    "Consume",
    "Dance_Loop",
    "Driving_Loop",
    "Farm_Harvest",
    "Farm_PlantSeed",
    "Farm_Watering",
    "Fixing_Kneeling",
    "Idle_FoldArms_Loop",
    "Idle_Loop",
    "Idle_TalkingPhone_Loop",
    "Idle_Talking_Loop",
    "Interact",
    "Jog_Fwd_Loop",
    "Jump_Land",
    "Jump_Loop",
    "Jump_Start",
    "OverhandThrow",
    "PickUp_Table",
    "Sitting_Enter",
    "Sitting_Exit",
    "Sitting_Idle_Loop",
    "Sitting_Talking_Loop",
    "Sprint_Loop",
    "TreeChopping_Loop",
    "Walk_Carry_Loop",
    "Walk_Formal_Loop",
    "Walk_Loop",
    "Yes",
)
TARGET_HEIGHT_METRES = 1.82
MAX_TEXTURE_SIZE = 1024


def arguments() -> tuple[Path, Path, Path, Path]:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise SystemExit("Expected arguments after --") from exc

    values = [Path(value).resolve() for value in sys.argv[separator + 1 :]]
    if len(values) != 4:
        raise SystemExit("Expected RIGGED_CHARACTER.gltf UAL1.glb UAL2.glb OUTPUT.glb")
    return values[0], values[1], values[2], values[3]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def import_gltf(path: Path) -> None:
    result = bpy.ops.import_scene.gltf(filepath=str(path), import_shading="NORMALS")
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF import failed: {path}")


def scene_height(objects: list[bpy.types.Object]) -> float:
    points = [
        (obj.matrix_world @ Vector(corner)).z
        for obj in objects
        if obj.type == "MESH"
        for corner in obj.bound_box
    ]
    if not points:
        raise RuntimeError("Base character contains no mesh bounds")
    return max(points) - min(points)


def repair_source_image_paths() -> None:
    """Repair two duplicated-suffix paths in the Standard glTF package."""
    for image in bpy.data.images:
        if image.source != "FILE" or image.has_data:
            continue
        source = Path(bpy.path.abspath(image.filepath))
        if source.exists():
            image.reload()
            continue
        fallback = source.with_name(source.name.replace("_png.png", ".png"))
        if fallback == source or not fallback.exists():
            raise FileNotFoundError(f"Missing source image: {source}")
        image.filepath = str(fallback)
        image.reload()


def scale_images() -> None:
    for image in bpy.data.images:
        if image.source != "FILE" or max(image.size) <= MAX_TEXTURE_SIZE:
            continue
        scale = MAX_TEXTURE_SIZE / max(image.size)
        image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))


def import_actions(path: Path, selected: dict[str, bpy.types.Action]) -> None:
    objects_before = set(bpy.context.scene.objects)
    actions_before = set(bpy.data.actions)
    images_before = set(bpy.data.images)
    materials_before = set(bpy.data.materials)
    meshes_before = set(bpy.data.meshes)
    armatures_before = set(bpy.data.armatures)

    import_gltf(path)
    imported_objects = set(bpy.context.scene.objects) - objects_before
    imported_actions = set(bpy.data.actions) - actions_before

    for action in imported_actions:
        if action.name not in CLIPS:
            continue
        if action.name in selected:
            raise RuntimeError(f"Duplicate selected animation: {action.name}")
        action.use_fake_user = True
        selected[action.name] = action

    for obj in imported_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in imported_actions:
        if action.name not in selected:
            bpy.data.actions.remove(action)
    for mesh in set(bpy.data.meshes) - meshes_before:
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for armature in set(bpy.data.armatures) - armatures_before:
        if armature.users == 0:
            bpy.data.armatures.remove(armature)
    for material in set(bpy.data.materials) - materials_before:
        if material.users == 0:
            bpy.data.materials.remove(material)
    for image in set(bpy.data.images) - images_before:
        if image.users == 0:
            bpy.data.images.remove(image)


def bind_nla(armature: bpy.types.Object, actions: dict[str, bpy.types.Action]) -> None:
    missing = sorted(set(CLIPS) - set(actions))
    if missing:
        raise RuntimeError(f"Missing selected animations: {', '.join(missing)}")

    armature.animation_data_create()
    armature.animation_data.action = None
    for name in CLIPS:
        action = actions[name]
        track = armature.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        if action.slots:
            strip.action_slot = action.slots[0]


def main() -> None:
    base_path, ual1_path, ual2_path, output_path = arguments()
    for required in (base_path, ual1_path, ual2_path):
        if not required.exists():
            raise FileNotFoundError(required)

    clear_scene()
    import_gltf(base_path)
    repair_source_image_paths()
    base_objects = list(bpy.context.scene.objects)
    armatures = [obj for obj in base_objects if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one base armature, found {len(armatures)}")
    armature = armatures[0]
    armature.name = "QuaterniusHeroRig"

    imported_height = scene_height(base_objects)
    scale = TARGET_HEIGHT_METRES / imported_height
    root_objects = [obj for obj in base_objects if obj.parent is None]
    for obj in root_objects:
        obj.scale = tuple(value * scale for value in obj.scale)

    selected: dict[str, bpy.types.Action] = {}
    import_actions(ual1_path, selected)
    import_actions(ual2_path, selected)
    bind_nla(armature, selected)
    scale_images()

    bpy.ops.object.select_all(action="DESELECT")
    for obj in base_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature

    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_def_bones=True,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_apply=False,
        export_image_format="JPEG",
        export_image_quality=85,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {output_path}")

    print(
        "QUATERNIUS_HERO_EXPORT",
        {
            "output": str(output_path),
            "height": TARGET_HEIGHT_METRES,
            "clips": len(CLIPS),
            "bones": len(armature.data.bones),
        },
    )


if __name__ == "__main__":
    main()
