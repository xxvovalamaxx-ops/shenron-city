"""Convert Kenney's CC0 animated-character FBX set into one web-ready GLB.

Run with Blender:

    blender --background --factory-startup --python scripts/convert-kenney-character.py -- \
      MODEL.fbx ANIMATIONS_DIRECTORY SKIN.png OUTPUT.glb

The source animation FBXs share the model's rig. Blender imports each clip on a
temporary armature; this script binds the useful action to the runtime armature,
removes the temporary object, and exports one self-contained GLB.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


CLIPS = ("idle", "jump", "run")
TARGET_HEIGHT_METRES = 1.78


def arguments() -> tuple[Path, Path, Path, Path]:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise SystemExit("Expected arguments after --") from exc

    values = [Path(value).resolve() for value in sys.argv[separator + 1 :]]
    if len(values) != 4:
        raise SystemExit("Expected MODEL.fbx ANIMATIONS_DIRECTORY SKIN.png OUTPUT.glb")
    return values[0], values[1], values[2], values[3]


def delete_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def import_fbx(path: Path) -> None:
    result = bpy.ops.import_scene.fbx(
        filepath=str(path),
        use_anim=True,
        use_image_search=False,
        ignore_leaf_bones=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"FBX import failed: {path}")


def action_for_clip(actions: set[bpy.types.Action], clip: str) -> bpy.types.Action:
    suffix = f"|{clip}".lower()
    matches = [action for action in actions if action.name.lower().endswith(suffix)]
    if len(matches) != 1:
        names = ", ".join(sorted(action.name for action in actions))
        raise RuntimeError(f"Expected one {clip!r} action; imported: {names}")
    return matches[0]


def configure_material(mesh: bpy.types.Object, skin_path: Path) -> None:
    image = bpy.data.images.load(str(skin_path), check_existing=False)
    image.name = "KenneyCharacterSkin"
    image.colorspace_settings.name = "sRGB"

    material = bpy.data.materials.new("KenneyCharacter")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError("Blender did not create a Principled BSDF node")

    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "RuntimeSkin"
    texture.image = image
    links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], principled.inputs["Alpha"])
    principled.inputs["Roughness"].default_value = 0.68
    principled.inputs["Specular IOR Level"].default_value = 0.28

    mesh.data.materials.clear()
    mesh.data.materials.append(material)


def main() -> None:
    model_path, animations_dir, skin_path, output_path = arguments()
    for required in (model_path, animations_dir, skin_path):
        if not required.exists():
            raise FileNotFoundError(required)

    delete_scene()
    import_fbx(model_path)

    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(armatures) != 1 or len(meshes) != 1:
        raise RuntimeError(
            f"Expected one armature and one mesh, got {len(armatures)} and {len(meshes)}"
        )

    armature = armatures[0]
    mesh = meshes[0]
    armature.name = "KenneyCharacterRig"
    mesh.name = "KenneyCharacterMesh"
    configure_material(mesh, skin_path)

    # Kenney's FBX is authored at about 3.77 m after Blender's importer. Keep
    # bone values untouched and scale the shared root to a believable adult.
    imported_height = mesh.dimensions.z
    uniform_scale = TARGET_HEIGHT_METRES / imported_height
    armature.scale = (uniform_scale,) * 3

    exported_actions: list[bpy.types.Action] = []
    for clip in CLIPS:
        objects_before = set(bpy.context.scene.objects)
        actions_before = set(bpy.data.actions)
        import_fbx(animations_dir / f"{clip}.fbx")

        imported_objects = set(bpy.context.scene.objects) - objects_before
        imported_actions = set(bpy.data.actions) - actions_before
        action = action_for_clip(imported_actions, clip)
        action.name = clip.capitalize()
        action.use_fake_user = True

        armature.animation_data_create()
        armature.animation_data.action = action
        # Blender 4.4+ actions use explicit slots. Assigning the Action alone
        # leaves action_slot unset and silently exports a static T-pose.
        armature.animation_data.action_slot = action.slots[0]
        exported_actions.append(action)

        for obj in imported_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for extra in imported_actions - {action}:
            bpy.data.actions.remove(extra)

    armature.animation_data.action = None
    for action in exported_actions:
        track = armature.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        strip.action_slot = action.slots[0]

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
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
        export_image_format="AUTO",
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {output_path}")

    print(
        "KENNEY_CHARACTER_EXPORT",
        {
            "output": str(output_path),
            "height": TARGET_HEIGHT_METRES,
            "clips": [action.name for action in exported_actions],
            "bones": len(armature.data.bones),
        },
    )


if __name__ == "__main__":
    main()
