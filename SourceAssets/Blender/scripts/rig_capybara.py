"""Build the animated, browser-ready Shenzhen City capybara.

Run inside Blender 5.1 through Blender Foundation's official MCP connector.
The production geometry is reconstructed locally with the MIT-licensed
TripoSR model from a committed project-authored profile, then optimized and
rigged here. The committed four-view turnaround supplies the coat projection
and visual proportions. The script creates a clean deformation mesh, bakes the
four views into one PBR coat, adds a 43-bone animal rig with normalized
four-influence weights, authors named animation actions, renders inspection
poses, saves the editable master, and exports the standalone web GLB.
"""

from __future__ import annotations

import bisect
import json
import math
import random
from pathlib import Path
from typing import Any

import bmesh
import bpy
from mathutils import Vector


SEED = 20260728
FPS = 30
TARGET_WIDTH = 0.46
TARGET_LENGTH = 1.24
TARGET_HEIGHT = 0.58
DECIMATE_RATIO = 0.25
FUR_CARD_COUNT = 0

SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[3]
SOURCE_DIR = (
    REPOSITORY_ROOT
    / "SourceAssets"
    / "Models"
    / "Characters"
    / "Source"
    / "Capybara"
)
EXPORT_DIR = (
    REPOSITORY_ROOT
    / "SourceAssets"
    / "Models"
    / "Characters"
    / "Exports"
    / "Capybara"
)
RUNTIME_DIR = REPOSITORY_ROOT / "public" / "models" / "animals" / "capybara"

SOURCE_MESH = SOURCE_DIR / "capybara_triposr_source.obj"
PROJECTION_IMAGES = {
    "front": SOURCE_DIR / "capybara_turn_front.png",
    "back": SOURCE_DIR / "capybara_turn_back.png",
    "left": SOURCE_DIR / "capybara_turn_left.png",
    "right": SOURCE_DIR / "capybara_turn_right.png",
}
REFERENCE_IMAGE = SOURCE_DIR / "capybara_reconstruction_reference.png"
GAME_ALBEDO = SOURCE_DIR / "capybara_game_albedo.jpg"
GAME_NORMAL = SOURCE_DIR / "capybara_game_normal.png"
GAME_ROUGHNESS = SOURCE_DIR / "capybara_game_roughness.png"
TRACKED_BLEND = SOURCE_DIR / "capybara_rigged.blend"
AUTHORING_GLB = EXPORT_DIR / "capybara_animated.glb"
RUNTIME_GLB = RUNTIME_DIR / "capybara.glb"

PREVIEW_SIDE = EXPORT_DIR / "capybara_animated_side.png"
PREVIEW_THREE_QUARTER = EXPORT_DIR / "capybara_animated_three_quarter.png"
PREVIEW_FRONT = EXPORT_DIR / "capybara_animated_front.png"
PREVIEW_WALK = EXPORT_DIR / "capybara_pose_walk.png"
PREVIEW_GRAZE = EXPORT_DIR / "capybara_pose_graze.png"
PREVIEW_SIT = EXPORT_DIR / "capybara_pose_sit.png"

LOOPING_ACTIONS = {
    "capybara_idle_breathe",
    "capybara_idle_shift",
    "capybara_walk",
    "capybara_trot",
    "capybara_run",
    "capybara_sit_idle",
    "capybara_sleep",
    "capybara_swim",
}

REQUIRED_ACTIONS = (
    "capybara_idle_breathe",
    "capybara_idle_shift",
    "capybara_ear_flick_l",
    "capybara_ear_flick_r",
    "capybara_sniff",
    "capybara_walk",
    "capybara_trot",
    "capybara_run",
    "capybara_turn_l_90",
    "capybara_turn_r_90",
    "capybara_graze",
    "capybara_drink",
    "capybara_sit_down",
    "capybara_sit_idle",
    "capybara_stand_up",
    "capybara_lie_down",
    "capybara_sleep",
    "capybara_wake_up",
    "capybara_alert_startle",
    "capybara_vocalize",
    "capybara_swim",
)


def ensure_paths() -> None:
    for path in (SOURCE_MESH, REFERENCE_IMAGE, *PROJECTION_IMAGES.values()):
        if not path.is_file():
            raise FileNotFoundError(path)
    for directory in (SOURCE_DIR, EXPORT_DIR, RUNTIME_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def clear_previous() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith("CAPYBARA_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        if collection.name.startswith("CAPYBARA_"):
            bpy.data.collections.remove(collection)
    for action in list(bpy.data.actions):
        if action.name.startswith("capybara_"):
            bpy.data.actions.remove(action)
    for material in list(bpy.data.materials):
        if material.name.startswith("CAPYBARA_"):
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.name.startswith("CAPYBARA_"):
            bpy.data.images.remove(image)


def bounds_world(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[i] for point in points) for i in range(3))),
        Vector(tuple(max(point[i] for point in points) for i in range(3))),
    )


def set_exact_dimensions(
    obj: bpy.types.Object,
    dimensions: tuple[float, float, float],
) -> None:
    minimum, maximum = bounds_world(obj)
    current = maximum - minimum
    if min(current) <= 0:
        raise RuntimeError(f"Invalid mesh dimensions: {tuple(current)}")
    obj.scale = tuple(dimensions[i] / current[i] for i in range(3))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    minimum, maximum = bounds_world(obj)
    obj.location -= Vector(
        (
            (minimum.x + maximum.x) * 0.5,
            (minimum.y + maximum.y) * 0.5,
            minimum.z,
        )
    )
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def import_source(collection: bpy.types.Collection) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(SOURCE_MESH))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    mesh_objects = [obj for obj in imported if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("Capybara source import produced no mesh")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    if len(mesh_objects) > 1:
        bpy.ops.object.join()
    source = bpy.context.view_layer.objects.active
    source.name = "CAPYBARA_GAME_TripoSRSource"
    source.data.name = "CAPYBARA_GAME_TripoSRSourceMesh"

    # Blender's OBJ import conversion and TripoSR's image-space orientation
    # must be applied before measuring. The final convention is -Y forward,
    # Z up, with adult real-world dimensions.
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    source.rotation_euler.x = math.radians(-90)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for owner in list(source.users_collection):
        owner.objects.unlink(source)
    collection.objects.link(source)
    set_exact_dimensions(source, (TARGET_WIDTH, TARGET_LENGTH, TARGET_HEIGHT))
    source.hide_render = True
    source.hide_set(True)
    return source


def create_game_mesh(
    source: bpy.types.Object,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    game_mesh = source.copy()
    game_mesh.data = source.data.copy()
    game_mesh.name = "CAPYBARA_GAME_Body"
    game_mesh.data.name = "CAPYBARA_GAME_BodyMesh"
    collection.objects.link(game_mesh)
    game_mesh.hide_render = False
    game_mesh.hide_set(False)

    bpy.ops.object.select_all(action="DESELECT")
    game_mesh.select_set(True)
    bpy.context.view_layer.objects.active = game_mesh
    game_mesh.data.materials.clear()

    # TripoSR's textured OBJ is visually coherent but its UV-exported surface
    # contains many open extraction boundaries. A fine voxel remesh closes
    # those boundaries before reduction while retaining the profile, paws,
    # ears, and muzzle at game scale.
    game_mesh.data.remesh_voxel_size = 0.004
    game_mesh.data.remesh_voxel_adaptivity = 0.0
    bpy.ops.object.voxel_remesh()

    decimate = game_mesh.modifiers.new("CAPYBARA_GAME_GameTopology", "DECIMATE")
    decimate.decimate_type = "COLLAPSE"
    decimate.ratio = DECIMATE_RATIO
    decimate.use_collapse_triangulate = True
    with bpy.context.temp_override(
        object=game_mesh,
        active_object=game_mesh,
        selected_objects=[game_mesh],
        selected_editable_objects=[game_mesh],
    ):
        bpy.ops.object.modifier_apply(modifier=decimate.name)

    smooth = game_mesh.modifiers.new("CAPYBARA_GAME_SurfaceRelax", "LAPLACIANSMOOTH")
    smooth.lambda_factor = 0.16
    smooth.iterations = 4
    smooth.use_volume_preserve = True
    with bpy.context.temp_override(
        object=game_mesh,
        active_object=game_mesh,
        selected_objects=[game_mesh],
        selected_editable_objects=[game_mesh],
    ):
        bpy.ops.object.modifier_apply(modifier=smooth.name)

    set_exact_dimensions(
        game_mesh,
        (TARGET_WIDTH, TARGET_LENGTH, TARGET_HEIGHT),
    )

    for polygon in game_mesh.data.polygons:
        polygon.use_smooth = True

    normal_mesh = bmesh.new()
    normal_mesh.from_mesh(game_mesh.data)
    bmesh.ops.recalc_face_normals(normal_mesh, faces=normal_mesh.faces)
    normal_mesh.to_mesh(game_mesh.data)
    normal_mesh.free()

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(58),
        margin_method="FRACTION",
        island_margin=0.006,
        area_weight=0.35,
        correct_aspect=True,
        scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    bm = bmesh.new()
    bm.from_mesh(game_mesh.data)
    nonmanifold = sum(1 for edge in bm.edges if not edge.is_manifold)
    volume = bm.calc_volume(signed=False)
    bm.free()
    if nonmanifold:
        raise RuntimeError(f"Game mesh has {nonmanifold} non-manifold edges")
    if volume <= 0:
        raise RuntimeError(f"Game mesh has invalid signed volume {volume}")

    game_mesh["asset_role"] = "skinned LOD0 game body"
    game_mesh["forward_axis_blender"] = "-Y"
    game_mesh["forward_axis_gltf"] = "+Z"
    game_mesh["source_pipeline"] = "local MIT-licensed TripoSR reconstruction"
    game_mesh["reference_pipeline"] = "project-authored capybara profile and turnaround"
    game_mesh["decimate_ratio"] = DECIMATE_RATIO
    return game_mesh


def create_projection_material() -> bpy.types.Material:
    material = bpy.data.materials.new("CAPYBARA_GAME_CoatBake")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    coordinates = nodes.new("ShaderNodeTexCoord")
    position = nodes.new("ShaderNodeSeparateXYZ")
    geometry = nodes.new("ShaderNodeNewGeometry")
    normal = nodes.new("ShaderNodeSeparateXYZ")

    left_coordinates = nodes.new("ShaderNodeCombineXYZ")
    right_coordinates = nodes.new("ShaderNodeCombineXYZ")
    front_coordinates = nodes.new("ShaderNodeCombineXYZ")
    back_coordinates = nodes.new("ShaderNodeCombineXYZ")
    invert_y = nodes.new("ShaderNodeMath")
    invert_x = nodes.new("ShaderNodeMath")
    invert_y.operation = "SUBTRACT"
    invert_y.inputs[0].default_value = 1.0
    invert_x.operation = "SUBTRACT"
    invert_x.inputs[0].default_value = 1.0

    textures: dict[str, bpy.types.Node] = {}
    for view, path in PROJECTION_IMAGES.items():
        texture = nodes.new("ShaderNodeTexImage")
        texture.name = f"CAPYBARA_GAME_{view.title()}Projection"
        texture.image = bpy.data.images.load(str(path), check_existing=True)
        texture.image.colorspace_settings.name = "sRGB"
        texture.interpolation = "Linear"
        texture.extension = "EXTEND"
        textures[view] = texture

    side_sign = nodes.new("ShaderNodeMapRange")
    front_sign = nodes.new("ShaderNodeMapRange")
    for mapper in (side_sign, front_sign):
        mapper.inputs["From Min"].default_value = -1.0
        mapper.inputs["From Max"].default_value = 1.0
        mapper.inputs["To Min"].default_value = 0.0
        mapper.inputs["To Max"].default_value = 1.0
        mapper.clamp = True

    side_pair = nodes.new("ShaderNodeMixRGB")
    front_back_pair = nodes.new("ShaderNodeMixRGB")
    axis_mix = nodes.new("ShaderNodeMixRGB")
    side_alpha_pair = nodes.new("ShaderNodeMixRGB")
    front_back_alpha_pair = nodes.new("ShaderNodeMixRGB")
    axis_alpha = nodes.new("ShaderNodeMixRGB")
    absolute_x = nodes.new("ShaderNodeMath")
    absolute_y = nodes.new("ShaderNodeMath")
    absolute_x.operation = "ABSOLUTE"
    absolute_y.operation = "ABSOLUTE"
    axis_sum = nodes.new("ShaderNodeMath")
    axis_sum.operation = "ADD"
    axis_epsilon = nodes.new("ShaderNodeMath")
    axis_epsilon.operation = "ADD"
    axis_epsilon.inputs[1].default_value = 0.001
    front_weight = nodes.new("ShaderNodeMath")
    front_weight.operation = "DIVIDE"

    coat_grade = nodes.new("ShaderNodeHueSaturation")
    coat_grade.inputs["Saturation"].default_value = 0.94
    coat_grade.inputs["Value"].default_value = 0.76
    coat_fill = nodes.new("ShaderNodeMixRGB")
    fallback = nodes.new("ShaderNodeRGB")
    fallback.outputs["Color"].default_value = (0.19, 0.065, 0.018, 1.0)

    micro_noise = nodes.new("ShaderNodeTexNoise")
    bump = nodes.new("ShaderNodeBump")
    micro_noise.inputs["Scale"].default_value = 245.0
    micro_noise.inputs["Detail"].default_value = 3.7
    micro_noise.inputs["Roughness"].default_value = 0.82
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.0015
    principled.inputs["Roughness"].default_value = 0.78
    principled.inputs["IOR"].default_value = 1.46
    principled.inputs["Specular IOR Level"].default_value = 0.23

    links.new(coordinates.outputs["Generated"], position.inputs["Vector"])
    links.new(geometry.outputs["Normal"], normal.inputs["Vector"])

    links.new(position.outputs["Y"], left_coordinates.inputs["X"])
    links.new(position.outputs["Z"], left_coordinates.inputs["Y"])
    links.new(position.outputs["Y"], invert_y.inputs[1])
    links.new(invert_y.outputs[0], right_coordinates.inputs["X"])
    links.new(position.outputs["Z"], right_coordinates.inputs["Y"])
    links.new(position.outputs["X"], front_coordinates.inputs["X"])
    links.new(position.outputs["Z"], front_coordinates.inputs["Y"])
    links.new(position.outputs["X"], invert_x.inputs[1])
    links.new(invert_x.outputs[0], back_coordinates.inputs["X"])
    links.new(position.outputs["Z"], back_coordinates.inputs["Y"])
    links.new(left_coordinates.outputs["Vector"], textures["left"].inputs["Vector"])
    links.new(right_coordinates.outputs["Vector"], textures["right"].inputs["Vector"])
    links.new(front_coordinates.outputs["Vector"], textures["front"].inputs["Vector"])
    links.new(back_coordinates.outputs["Vector"], textures["back"].inputs["Vector"])

    links.new(normal.outputs["X"], side_sign.inputs["Value"])
    links.new(normal.outputs["Y"], front_sign.inputs["Value"])
    links.new(side_sign.outputs["Result"], side_pair.inputs["Fac"])
    links.new(textures["right"].outputs["Color"], side_pair.inputs[1])
    links.new(textures["left"].outputs["Color"], side_pair.inputs[2])
    links.new(side_sign.outputs["Result"], side_alpha_pair.inputs["Fac"])
    links.new(textures["right"].outputs["Alpha"], side_alpha_pair.inputs[1])
    links.new(textures["left"].outputs["Alpha"], side_alpha_pair.inputs[2])
    links.new(front_sign.outputs["Result"], front_back_pair.inputs["Fac"])
    links.new(textures["front"].outputs["Color"], front_back_pair.inputs[1])
    links.new(textures["back"].outputs["Color"], front_back_pair.inputs[2])
    links.new(front_sign.outputs["Result"], front_back_alpha_pair.inputs["Fac"])
    links.new(textures["front"].outputs["Alpha"], front_back_alpha_pair.inputs[1])
    links.new(textures["back"].outputs["Alpha"], front_back_alpha_pair.inputs[2])

    links.new(normal.outputs["X"], absolute_x.inputs[0])
    links.new(normal.outputs["Y"], absolute_y.inputs[0])
    links.new(absolute_x.outputs[0], axis_sum.inputs[0])
    links.new(absolute_y.outputs[0], axis_sum.inputs[1])
    links.new(axis_sum.outputs[0], axis_epsilon.inputs[0])
    links.new(absolute_y.outputs[0], front_weight.inputs[0])
    links.new(axis_epsilon.outputs[0], front_weight.inputs[1])
    links.new(front_weight.outputs[0], axis_mix.inputs["Fac"])
    links.new(side_pair.outputs["Color"], axis_mix.inputs[1])
    links.new(front_back_pair.outputs["Color"], axis_mix.inputs[2])
    links.new(front_weight.outputs[0], axis_alpha.inputs["Fac"])
    links.new(side_alpha_pair.outputs["Color"], axis_alpha.inputs[1])
    links.new(front_back_alpha_pair.outputs["Color"], axis_alpha.inputs[2])
    links.new(axis_alpha.outputs["Color"], coat_fill.inputs["Fac"])
    links.new(fallback.outputs["Color"], coat_fill.inputs[1])
    links.new(axis_mix.outputs["Color"], coat_fill.inputs[2])
    links.new(coat_fill.outputs["Color"], coat_grade.inputs["Color"])
    links.new(coat_grade.outputs["Color"], principled.inputs["Base Color"])
    links.new(coordinates.outputs["Generated"], micro_noise.inputs["Vector"])
    links.new(micro_noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def create_bake_target(
    material: bpy.types.Material,
    name: str,
    width: int,
    height: int,
    alpha: bool,
) -> tuple[bpy.types.Node, bpy.types.Image]:
    nodes = material.node_tree.nodes
    target = nodes.new("ShaderNodeTexImage")
    target.name = name
    image = bpy.data.images.new(
        name,
        width=width,
        height=height,
        alpha=alpha,
        float_buffer=False,
    )
    target.image = image
    for node in nodes:
        node.select = False
    target.select = True
    nodes.active = target
    return target, image


def save_bake(
    image: bpy.types.Image,
    path: Path,
    file_format: str,
    quality: int | None = None,
) -> bpy.types.Image:
    image.filepath_raw = str(path)
    image.file_format = file_format
    if quality is not None:
        bpy.context.scene.render.image_settings.quality = quality
    image.save()
    return bpy.data.images.load(str(path), check_existing=False)


def bake_game_textures(
    game_mesh: bpy.types.Object,
    material: bpy.types.Material,
) -> None:
    game_mesh.data.materials.clear()
    game_mesh.data.materials.append(material)
    scene = bpy.context.scene
    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.margin = 8
    bpy.ops.object.select_all(action="DESELECT")
    game_mesh.select_set(True)
    bpy.context.view_layer.objects.active = game_mesh

    albedo_target, albedo_image = create_bake_target(
        material,
        "CAPYBARA_GAME_AlbedoBake",
        2048,
        2048,
        False,
    )
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"COLOR"},
        use_clear=True,
        margin=8,
    )
    albedo = save_bake(albedo_image, GAME_ALBEDO, "JPEG", quality=92)

    material.node_tree.nodes.active = albedo_target
    normal_target, normal_image = create_bake_target(
        material,
        "CAPYBARA_GAME_NormalBake",
        1024,
        1024,
        False,
    )
    material.node_tree.nodes.active = normal_target
    bpy.ops.object.bake(
        type="NORMAL",
        normal_space="TANGENT",
        use_clear=True,
        margin=8,
    )
    normal = save_bake(normal_image, GAME_NORMAL, "PNG")
    normal.colorspace_settings.name = "Non-Color"

    roughness_target, roughness_image = create_bake_target(
        material,
        "CAPYBARA_GAME_RoughnessBake",
        1024,
        1024,
        False,
    )
    material.node_tree.nodes.active = roughness_target
    bpy.ops.object.bake(
        type="ROUGHNESS",
        use_clear=True,
        margin=8,
    )
    roughness = save_bake(roughness_image, GAME_ROUGHNESS, "PNG")
    roughness.colorspace_settings.name = "Non-Color"
    scene.render.engine = previous_engine

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    albedo_node = nodes.new("ShaderNodeTexImage")
    normal_node = nodes.new("ShaderNodeTexImage")
    roughness_node = nodes.new("ShaderNodeTexImage")
    normal_map = nodes.new("ShaderNodeNormalMap")
    albedo_node.image = albedo
    albedo_node.image.colorspace_settings.name = "sRGB"
    normal_node.image = normal
    normal_node.image.colorspace_settings.name = "Non-Color"
    roughness_node.image = roughness
    roughness_node.image.colorspace_settings.name = "Non-Color"
    normal_map.inputs["Strength"].default_value = 0.48
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["IOR"].default_value = 1.46
    principled.inputs["Specular IOR Level"].default_value = 0.24
    links.new(albedo_node.outputs["Color"], principled.inputs["Base Color"])
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    links.new(roughness_node.outputs["Color"], principled.inputs["Roughness"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    material.name = "CAPYBARA_GAME_Coat"
    material["asset_role"] = "portable de-lit coat material"


def add_bone(
    armature: bpy.types.Armature,
    name: str,
    head: tuple[float, float, float],
    tail: tuple[float, float, float],
    parent: str | None = None,
) -> bpy.types.EditBone:
    bone = armature.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    bone.roll = 0.0
    bone.use_deform = True
    if parent:
        bone.parent = armature.edit_bones[parent]
    return bone


def create_rig(collection: bpy.types.Collection) -> bpy.types.Object:
    armature = bpy.data.armatures.new("CAPYBARA_GAME_Armature")
    rig = bpy.data.objects.new("CAPYBARA_GAME_Rig", armature)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    add_bone(armature, "root", (0, 0, 0), (0, 0, 0.12))
    add_bone(armature, "pelvis", (0, 0.34, 0.30), (0, 0.10, 0.34), "root")
    add_bone(armature, "spine_01", (0, 0.10, 0.34), (0, -0.10, 0.35), "pelvis")
    add_bone(armature, "spine_02", (0, -0.10, 0.35), (0, -0.24, 0.37), "spine_01")
    add_bone(armature, "chest", (0, -0.24, 0.37), (0, -0.34, 0.39), "spine_02")
    add_bone(armature, "neck_01", (0, -0.34, 0.39), (0, -0.43, 0.41), "chest")
    add_bone(armature, "neck_02", (0, -0.43, 0.41), (0, -0.50, 0.40), "neck_01")
    add_bone(armature, "head", (0, -0.50, 0.40), (0, -0.61, 0.37), "neck_02")
    add_bone(armature, "jaw", (0, -0.49, 0.34), (0, -0.61, 0.32), "head")

    for suffix, x in (("L", 0.14), ("R", -0.14)):
        add_bone(
            armature,
            f"ear.{suffix}",
            (x, -0.44, 0.44),
            (x, -0.39, 0.51),
            "head",
        )
        add_bone(
            armature,
            f"front_scapula.{suffix}",
            (x, -0.28, 0.39),
            (x, -0.32, 0.31),
            "chest",
        )
        add_bone(
            armature,
            f"front_upper.{suffix}",
            (x, -0.32, 0.31),
            (x, -0.34, 0.20),
            f"front_scapula.{suffix}",
        )
        add_bone(
            armature,
            f"front_forearm.{suffix}",
            (x, -0.34, 0.20),
            (x, -0.32, 0.095),
            f"front_upper.{suffix}",
        )
        add_bone(
            armature,
            f"front_carpal.{suffix}",
            (x, -0.32, 0.095),
            (x, -0.36, 0.045),
            f"front_forearm.{suffix}",
        )
        add_bone(
            armature,
            f"front_paw.{suffix}",
            (x, -0.36, 0.045),
            (x, -0.46, 0.025),
            f"front_carpal.{suffix}",
        )
        for toe_index, toe_x in enumerate((-0.035, -0.012, 0.012, 0.035), 1):
            add_bone(
                armature,
                f"front_toe_{toe_index}.{suffix}",
                (x + toe_x, -0.43, 0.032),
                (x + toe_x, -0.49, 0.018),
                f"front_paw.{suffix}",
            )

        add_bone(
            armature,
            f"hind_thigh.{suffix}",
            (x, 0.34, 0.34),
            (x, 0.41, 0.22),
            "pelvis",
        )
        add_bone(
            armature,
            f"hind_shin.{suffix}",
            (x, 0.41, 0.22),
            (x, 0.36, 0.10),
            f"hind_thigh.{suffix}",
        )
        add_bone(
            armature,
            f"hind_hock.{suffix}",
            (x, 0.36, 0.10),
            (x, 0.41, 0.045),
            f"hind_shin.{suffix}",
        )
        add_bone(
            armature,
            f"hind_paw.{suffix}",
            (x, 0.41, 0.045),
            (x, 0.50, 0.025),
            f"hind_hock.{suffix}",
        )
        for toe_index, toe_x in enumerate((-0.025, 0.0, 0.025), 1):
            add_bone(
                armature,
                f"hind_toe_{toe_index}.{suffix}",
                (x + toe_x, 0.47, 0.032),
                (x + toe_x, 0.53, 0.018),
                f"hind_paw.{suffix}",
            )

    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    rig["asset_role"] = "43-bone capybara deformation rig"
    rig["exported_deform_bones"] = len(armature.bones)
    if len(armature.bones) != 43:
        raise RuntimeError(f"Expected 43 bones, created {len(armature.bones)}")
    return rig


def prune_and_normalize_weights(mesh: bpy.types.Object) -> None:
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    deform = bm.verts.layers.deform.active
    if deform is None:
        bm.free()
        raise RuntimeError("Automatic weighting produced no deform layer")
    unweighted = 0
    for vertex in bm.verts:
        weights = sorted(
            vertex[deform].items(),
            key=lambda item: item[1],
            reverse=True,
        )
        keep = [(index, weight) for index, weight in weights[:4] if weight >= 0.01]
        if not keep and weights:
            keep = [weights[0]]
        if not keep:
            unweighted += 1
            continue
        total = sum(weight for _, weight in keep)
        vertex[deform].clear()
        for index, weight in keep:
            vertex[deform][index] = weight / total
    bm.to_mesh(mesh.data)
    bm.free()
    mesh.data.update()
    if unweighted:
        raise RuntimeError(f"{unweighted} game vertices have no skin weights")


def bind_mesh(game_mesh: bpy.types.Object, rig: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    game_mesh.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    status = bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    if "FINISHED" not in status:
        raise RuntimeError(f"Automatic armature binding failed: {status}")
    prune_and_normalize_weights(game_mesh)
    modifier = next(
        (item for item in game_mesh.modifiers if item.type == "ARMATURE"),
        None,
    )
    if modifier is None:
        raise RuntimeError("Armature modifier missing after binding")
    modifier.use_deform_preserve_volume = True


def create_detail_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return material


def parent_to_bone(
    obj: bpy.types.Object,
    rig: bpy.types.Object,
    bone_name: str,
) -> None:
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def create_face_details(
    rig: bpy.types.Object,
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    eye_material = create_detail_material(
        "CAPYBARA_GAME_EyeMaterial",
        (0.003, 0.002, 0.0015, 1),
        0.08,
    )
    nose_material = create_detail_material(
        "CAPYBARA_GAME_NostrilMaterial",
        (0.012, 0.006, 0.003, 1),
        0.34,
    )
    details: list[bpy.types.Object] = []
    for suffix, x in (("L", 0.228), ("R", -0.228)):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=20,
            ring_count=12,
            radius=1.0,
            location=(x, -0.43, 0.42),
        )
        eye = bpy.context.object
        eye.name = f"CAPYBARA_GAME_Eye.{suffix}"
        eye.scale = (0.010, 0.027, 0.018)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for owner in list(eye.users_collection):
            owner.objects.unlink(eye)
        collection.objects.link(eye)
        eye.data.materials.append(eye_material)
        for polygon in eye.data.polygons:
            polygon.use_smooth = True
        parent_to_bone(eye, rig, "head")
        details.append(eye)

    for suffix, x in (("L", 0.052), ("R", -0.052)):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=12,
            ring_count=8,
            radius=1.0,
            location=(x, -0.614, 0.347),
        )
        nostril = bpy.context.object
        nostril.name = f"CAPYBARA_GAME_Nostril.{suffix}"
        nostril.scale = (0.012, 0.006, 0.008)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for owner in list(nostril.users_collection):
            owner.objects.unlink(nostril)
        collection.objects.link(nostril)
        nostril.data.materials.append(nose_material)
        parent_to_bone(nostril, rig, "head")
        details.append(nostril)
    return details


def create_fur_cards(
    game_mesh: bpy.types.Object,
    rig: bpy.types.Object,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    mesh = game_mesh.data
    mesh.calc_loop_triangles()
    candidates = []
    cumulative = []
    total_area = 0.0
    for triangle in mesh.loop_triangles:
        center = sum(
            (mesh.vertices[index].co for index in triangle.vertices),
            Vector(),
        ) / 3
        if center.z < 0.11 or center.y < -0.56:
            continue
        total_area += triangle.area
        candidates.append(triangle)
        cumulative.append(total_area)
    if not candidates:
        raise RuntimeError("No triangles available for fur cards")

    rng = random.Random(SEED)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    root_weights: list[dict[int, float]] = []
    for _ in range(FUR_CARD_COUNT):
        triangle = candidates[
            bisect.bisect_left(cumulative, rng.random() * total_area)
        ]
        tri_vertices = [mesh.vertices[index] for index in triangle.vertices]
        r1 = math.sqrt(rng.random())
        r2 = rng.random()
        weights = (1.0 - r1, r1 * (1.0 - r2), r1 * r2)
        root = sum(
            (tri_vertices[i].co * weights[i] for i in range(3)),
            Vector(),
        )
        normal = sum(
            (tri_vertices[i].normal * weights[i] for i in range(3)),
            Vector(),
        ).normalized()
        tailward = Vector((0.0, 1.0, -0.045))
        # Keep the silhouette fuzz close to the coat. Long, normal-facing cards
        # read as porcupine quills in real-time lighting.
        flow = (normal * 0.03 + tailward).normalized()
        lateral = normal.cross(flow)
        if lateral.length < 1e-5:
            lateral = Vector((1.0, 0.0, 0.0))
        lateral.normalize()
        length = rng.uniform(0.004, 0.012)
        half_width = rng.uniform(0.00015, 0.00035)
        base = root + normal * 0.0003
        tip = base + flow * length + normal * rng.uniform(0.0001, 0.0006)
        offset = lateral * half_width
        first = len(vertices)
        vertices.extend((tuple(base - offset), tuple(base + offset), tuple(tip)))
        faces.append((first, first + 1, first + 2))

        interpolated: dict[int, float] = {}
        for i, vertex in enumerate(tri_vertices):
            for group in vertex.groups:
                interpolated[group.group] = (
                    interpolated.get(group.group, 0.0)
                    + group.weight * weights[i]
                )
        kept = sorted(
            interpolated.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:4]
        total = sum(value for _, value in kept) or 1.0
        normalized = {index: value / total for index, value in kept}
        root_weights.extend((normalized, normalized, normalized))

    fur_data = bpy.data.meshes.new("CAPYBARA_GAME_FurCardsMesh")
    fur_data.from_pydata(vertices, [], faces)
    fur_data.update()
    fur = bpy.data.objects.new("CAPYBARA_GAME_FurCards", fur_data)
    collection.objects.link(fur)
    fur_material = create_detail_material(
        "CAPYBARA_GAME_FurCardMaterial",
        (0.10, 0.035, 0.008, 1),
        0.86,
    )
    fur_data.materials.append(fur_material)

    for group in game_mesh.vertex_groups:
        fur.vertex_groups.new(name=group.name)
    for vertex_index, weights in enumerate(root_weights):
        for group_index, value in weights.items():
            if group_index < len(fur.vertex_groups):
                fur.vertex_groups[group_index].add(
                    [vertex_index],
                    value,
                    "REPLACE",
                )
    fur.parent = rig
    modifier = fur.modifiers.new("CAPYBARA_GAME_Armature", "ARMATURE")
    modifier.object = rig
    modifier.use_deform_preserve_volume = True
    fur["asset_role"] = "skinned coarse silhouette guard-hair cards"
    fur["card_count"] = FUR_CARD_COUNT
    return fur


Transform = dict[str, dict[str, tuple[float, float, float]]]


def create_action(
    rig: bpy.types.Object,
    name: str,
    duration_seconds: float,
    keys: list[tuple[float, Transform]],
) -> bpy.types.Action:
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    animated_bones = sorted(
        {
            bone_name
            for _, transforms in keys
            for bone_name in transforms
        }
    )
    for time_seconds, transforms in keys:
        frame = round(time_seconds * FPS)
        bpy.context.scene.frame_set(frame)
        for bone_name in animated_bones:
            pose_bone = rig.pose.bones[bone_name]
            pose_bone.rotation_mode = "XYZ"
            pose_bone.location = (0, 0, 0)
            pose_bone.rotation_euler = (0, 0, 0)
            pose_bone.scale = (1, 1, 1)
            values = transforms.get(bone_name, {})
            if "location" in values:
                pose_bone.location = values["location"]
            if "rotation" in values:
                pose_bone.rotation_euler = values["rotation"]
            if "scale" in values:
                pose_bone.scale = values["scale"]
            pose_bone.keyframe_insert(
                data_path="location",
                frame=frame,
                group=bone_name,
            )
            pose_bone.keyframe_insert(
                data_path="rotation_euler",
                frame=frame,
                group=bone_name,
            )
            pose_bone.keyframe_insert(
                data_path="scale",
                frame=frame,
                group=bone_name,
            )
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = round(duration_seconds * FPS)
    action["duration_seconds"] = duration_seconds
    action["loop"] = name in LOOPING_ACTIONS
    return action


def transform(
    *,
    rotation: tuple[float, float, float] | None = None,
    location: tuple[float, float, float] | None = None,
    scale: tuple[float, float, float] | None = None,
) -> dict[str, tuple[float, float, float]]:
    output: dict[str, tuple[float, float, float]] = {}
    if rotation is not None:
        output["rotation"] = rotation
    if location is not None:
        output["location"] = location
    if scale is not None:
        output["scale"] = scale
    return output


def locomotion_keys(
    duration: float,
    upper_angle: float,
    lower_angle: float,
    body_bob: float,
) -> list[tuple[float, Transform]]:
    keys = []
    for phase_index, phase in enumerate((0.0, 0.25, 0.5, 0.75, 1.0)):
        diagonal = 1 if phase_index in (0, 4) else -1 if phase_index == 2 else 0
        if phase_index == 1:
            diagonal = 0
        if phase_index == 3:
            diagonal = 0
        cycle = math.sin(phase * math.tau)
        opposite = -cycle
        values: Transform = {
            "root": transform(
                location=(0, 0, body_bob * (0.5 - 0.5 * math.cos(phase * math.tau * 2)))
            ),
            "chest": transform(rotation=(0.0, 0.0, cycle * 0.025)),
            "pelvis": transform(rotation=(0.0, 0.0, opposite * 0.02)),
            "neck_01": transform(rotation=(cycle * 0.035, 0.0, 0.0)),
        }
        for suffix, sign in (("L", 1.0), ("R", -1.0)):
            front = cycle * sign
            hind = opposite * sign
            values[f"front_upper.{suffix}"] = transform(
                rotation=(front * upper_angle, 0, 0)
            )
            values[f"front_forearm.{suffix}"] = transform(
                rotation=(max(0.0, -front) * lower_angle, 0, 0)
            )
            values[f"front_carpal.{suffix}"] = transform(
                rotation=(-front * upper_angle * 0.35, 0, 0)
            )
            values[f"hind_thigh.{suffix}"] = transform(
                rotation=(hind * upper_angle * 0.88, 0, 0)
            )
            values[f"hind_shin.{suffix}"] = transform(
                rotation=(max(0.0, -hind) * lower_angle, 0, 0)
            )
            values[f"hind_hock.{suffix}"] = transform(
                rotation=(-hind * upper_angle * 0.42, 0, 0)
            )
        keys.append((phase * duration, values))
    return keys


def create_actions(rig: bpy.types.Object) -> dict[str, bpy.types.Action]:
    actions: dict[str, bpy.types.Action] = {}

    actions["capybara_idle_breathe"] = create_action(
        rig,
        "capybara_idle_breathe",
        4.0,
        [
            (0.0, {"chest": transform(scale=(1, 1, 1)), "head": transform(rotation=(0, 0, 0))}),
            (1.0, {"chest": transform(scale=(1.012, 1.018, 1.018)), "head": transform(rotation=(0.015, 0, 0.018))}),
            (2.0, {"chest": transform(scale=(1, 1, 1)), "head": transform(rotation=(0, 0, 0))}),
            (3.0, {"chest": transform(scale=(1.008, 1.012, 1.012)), "head": transform(rotation=(-0.01, 0, -0.012))}),
            (4.0, {"chest": transform(scale=(1, 1, 1)), "head": transform(rotation=(0, 0, 0))}),
        ],
    )
    actions["capybara_idle_shift"] = create_action(
        rig,
        "capybara_idle_shift",
        6.0,
        [
            (0.0, {"pelvis": transform(), "chest": transform(), "head": transform()}),
            (1.5, {"pelvis": transform(location=(0.008, 0, -0.004), rotation=(0, 0, 0.025)), "chest": transform(rotation=(0, 0, -0.025)), "head": transform(rotation=(0.02, 0, 0.05))}),
            (3.0, {"pelvis": transform(), "chest": transform(), "head": transform()}),
            (4.5, {"pelvis": transform(location=(-0.008, 0, -0.004), rotation=(0, 0, -0.025)), "chest": transform(rotation=(0, 0, 0.025)), "head": transform(rotation=(-0.015, 0, -0.05))}),
            (6.0, {"pelvis": transform(), "chest": transform(), "head": transform()}),
        ],
    )
    for suffix, direction in (("l", 1.0), ("r", -1.0)):
        bone = f"ear.{suffix.upper()}"
        actions[f"capybara_ear_flick_{suffix}"] = create_action(
            rig,
            f"capybara_ear_flick_{suffix}",
            0.45,
            [
                (0.0, {bone: transform()}),
                (0.14, {bone: transform(rotation=(0.10, 0.08 * direction, 0.36 * direction))}),
                (0.28, {bone: transform(rotation=(-0.05, 0, -0.16 * direction))}),
                (0.45, {bone: transform()}),
            ],
        )
    actions["capybara_sniff"] = create_action(
        rig,
        "capybara_sniff",
        1.8,
        [
            (0.0, {"neck_01": transform(), "neck_02": transform(), "head": transform()}),
            (0.45, {"neck_01": transform(rotation=(-0.10, 0, 0)), "neck_02": transform(rotation=(-0.08, 0, 0.05)), "head": transform(rotation=(-0.08, 0, -0.08))}),
            (0.9, {"neck_01": transform(rotation=(0.06, 0, 0)), "neck_02": transform(rotation=(0.08, 0, -0.05)), "head": transform(rotation=(0.10, 0, 0.09))}),
            (1.35, {"neck_01": transform(rotation=(-0.04, 0, 0)), "neck_02": transform(rotation=(-0.03, 0, 0.04)), "head": transform(rotation=(-0.04, 0, -0.06))}),
            (1.8, {"neck_01": transform(), "neck_02": transform(), "head": transform()}),
        ],
    )
    for name, duration, upper, lower, bob in (
        ("capybara_walk", 1.0, 0.34, 0.52, 0.012),
        ("capybara_trot", 0.67, 0.52, 0.68, 0.022),
        ("capybara_run", 0.48, 0.72, 0.86, 0.040),
    ):
        actions[name] = create_action(
            rig,
            name,
            duration,
            locomotion_keys(duration, upper, lower, bob),
        )
    for name, direction in (("capybara_turn_l_90", 1.0), ("capybara_turn_r_90", -1.0)):
        actions[name] = create_action(
            rig,
            name,
            1.0,
            [
                (0.0, {"pelvis": transform(), "spine_01": transform(), "chest": transform()}),
                (0.5, {"pelvis": transform(rotation=(0, 0, 0.16 * direction)), "spine_01": transform(rotation=(0, 0, 0.12 * direction)), "chest": transform(rotation=(0, 0, 0.08 * direction))}),
                (1.0, {"pelvis": transform(), "spine_01": transform(), "chest": transform()}),
            ],
        )
    graze_pose: Transform = {
        "neck_01": transform(rotation=(0.42, 0, 0)),
        "neck_02": transform(rotation=(0.45, 0, 0)),
        "head": transform(rotation=(0.32, 0, 0)),
        "jaw": transform(rotation=(0.08, 0, 0)),
    }
    actions["capybara_graze"] = create_action(
        rig,
        "capybara_graze",
        5.0,
        [
            (0.0, {"neck_01": transform(), "neck_02": transform(), "head": transform(), "jaw": transform()}),
            (1.0, graze_pose),
            (2.0, {**graze_pose, "jaw": transform(rotation=(0.18, 0, 0))}),
            (3.0, {**graze_pose, "jaw": transform(rotation=(0.04, 0, 0))}),
            (4.0, graze_pose),
            (5.0, {"neck_01": transform(), "neck_02": transform(), "head": transform(), "jaw": transform()}),
        ],
    )
    drink_pose: Transform = {
        "neck_01": transform(rotation=(0.50, 0, 0)),
        "neck_02": transform(rotation=(0.55, 0, 0)),
        "head": transform(rotation=(0.38, 0, 0)),
    }
    actions["capybara_drink"] = create_action(
        rig,
        "capybara_drink",
        5.0,
        [
            (0.0, {"neck_01": transform(), "neck_02": transform(), "head": transform()}),
            (1.1, drink_pose),
            (2.4, {**drink_pose, "head": transform(rotation=(0.42, 0, 0.025))}),
            (3.8, drink_pose),
            (5.0, {"neck_01": transform(), "neck_02": transform(), "head": transform()}),
        ],
    )
    sit_pose: Transform = {
        "root": transform(location=(0, 0.03, -0.02)),
        "pelvis": transform(rotation=(0.10, 0, 0)),
        "spine_01": transform(rotation=(-0.04, 0, 0)),
        "hind_thigh.L": transform(rotation=(-0.35, 0, 0)),
        "hind_thigh.R": transform(rotation=(-0.35, 0, 0)),
        "hind_shin.L": transform(rotation=(0.40, 0, 0)),
        "hind_shin.R": transform(rotation=(0.40, 0, 0)),
        "hind_hock.L": transform(rotation=(-0.18, 0, 0)),
        "hind_hock.R": transform(rotation=(-0.18, 0, 0)),
    }
    rest_sit_keys = {bone: transform() for bone in sit_pose}
    actions["capybara_sit_down"] = create_action(
        rig,
        "capybara_sit_down",
        1.4,
        [(0.0, rest_sit_keys), (0.7, {**sit_pose, "root": transform(location=(0, 0.015, -0.01))}), (1.4, sit_pose)],
    )
    actions["capybara_sit_idle"] = create_action(
        rig,
        "capybara_sit_idle",
        5.0,
        [
            (0.0, sit_pose),
            (2.5, {**sit_pose, "chest": transform(scale=(1.01, 1.015, 1.015)), "head": transform(rotation=(0, 0, 0.05))}),
            (5.0, sit_pose),
        ],
    )
    actions["capybara_stand_up"] = create_action(
        rig,
        "capybara_stand_up",
        1.4,
        [(0.0, sit_pose), (0.7, {**sit_pose, "root": transform(location=(0, 0.015, -0.01))}), (1.4, rest_sit_keys)],
    )
    lie_pose: Transform = {
        "root": transform(location=(0, 0, -0.06), rotation=(0, 0, 0.03)),
        "pelvis": transform(rotation=(0.04, 0, 0)),
        "chest": transform(rotation=(-0.03, 0, 0)),
        "front_upper.L": transform(rotation=(-0.55, 0, 0)),
        "front_upper.R": transform(rotation=(-0.55, 0, 0)),
        "hind_thigh.L": transform(rotation=(-0.60, 0, 0)),
        "hind_thigh.R": transform(rotation=(-0.60, 0, 0)),
        "neck_01": transform(rotation=(0.18, 0, 0)),
        "head": transform(rotation=(0.12, 0, 0)),
    }
    rest_lie_keys = {bone: transform() for bone in lie_pose}
    actions["capybara_lie_down"] = create_action(
        rig,
        "capybara_lie_down",
        1.8,
        [(0.0, rest_lie_keys), (0.9, {**lie_pose, "root": transform(location=(0, 0, -0.03))}), (1.8, lie_pose)],
    )
    actions["capybara_sleep"] = create_action(
        rig,
        "capybara_sleep",
        8.0,
        [
            (0.0, lie_pose),
            (4.0, {**lie_pose, "chest": transform(rotation=(-0.06, 0, 0), scale=(1.012, 1.022, 1.018))}),
            (8.0, lie_pose),
        ],
    )
    actions["capybara_wake_up"] = create_action(
        rig,
        "capybara_wake_up",
        1.8,
        [(0.0, lie_pose), (0.9, {**lie_pose, "root": transform(location=(0, 0, -0.03))}), (1.8, rest_lie_keys)],
    )
    actions["capybara_alert_startle"] = create_action(
        rig,
        "capybara_alert_startle",
        1.0,
        [
            (0.0, {"root": transform(), "neck_01": transform(), "head": transform(), "ear.L": transform(), "ear.R": transform()}),
            (0.18, {"root": transform(location=(0, 0, 0.045)), "neck_01": transform(rotation=(-0.22, 0, 0)), "head": transform(rotation=(-0.18, 0, 0)), "ear.L": transform(rotation=(-0.14, 0, -0.14)), "ear.R": transform(rotation=(-0.14, 0, 0.14))}),
            (0.55, {"root": transform(location=(0, 0, 0.012)), "neck_01": transform(rotation=(-0.08, 0, 0)), "head": transform(rotation=(-0.06, 0, 0)), "ear.L": transform(), "ear.R": transform()}),
            (1.0, {"root": transform(), "neck_01": transform(), "head": transform(), "ear.L": transform(), "ear.R": transform()}),
        ],
    )
    actions["capybara_vocalize"] = create_action(
        rig,
        "capybara_vocalize",
        1.2,
        [
            (0.0, {"jaw": transform(), "head": transform()}),
            (0.25, {"jaw": transform(rotation=(0.26, 0, 0)), "head": transform(rotation=(-0.06, 0, 0))}),
            (0.5, {"jaw": transform(rotation=(0.08, 0, 0)), "head": transform(rotation=(0.02, 0, 0))}),
            (0.75, {"jaw": transform(rotation=(0.22, 0, 0)), "head": transform(rotation=(-0.04, 0, 0))}),
            (1.2, {"jaw": transform(), "head": transform()}),
        ],
    )
    swim_keys = locomotion_keys(1.2, 0.46, 0.62, 0.014)
    for _, values in swim_keys:
        values["root"] = transform(location=(0, 0, 0.10))
        values["neck_01"] = transform(rotation=(-0.08, 0, 0))
        values["head"] = transform(rotation=(-0.06, 0, 0))
    actions["capybara_swim"] = create_action(
        rig,
        "capybara_swim",
        1.2,
        swim_keys,
    )

    if tuple(actions) != REQUIRED_ACTIONS:
        missing = sorted(set(REQUIRED_ACTIONS) - set(actions))
        extra = sorted(set(actions) - set(REQUIRED_ACTIONS))
        raise RuntimeError(f"Action contract mismatch: missing={missing}, extra={extra}")
    rig.animation_data.action = actions["capybara_idle_breathe"]
    bpy.context.scene.frame_set(0)
    return actions


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> None:
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light_data.color = color
    light = bpy.data.objects.new(name, light_data)
    collection.objects.link(light)
    light.location = location
    look_at(light, Vector((0, 0, 0.3)))


def create_studio() -> tuple[bpy.types.Collection, bpy.types.Object]:
    studio = bpy.data.collections.new("CAPYBARA_GAME_STUDIO")
    bpy.context.scene.collection.children.link(studio)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.003))
    ground = bpy.context.object
    ground.name = "CAPYBARA_GAME_StudioGround"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    studio.objects.link(ground)
    ground_material = create_detail_material(
        "CAPYBARA_GAME_StudioGroundMaterial",
        (0.20, 0.20, 0.20, 1),
        0.92,
    )
    ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("CAPYBARA_GAME_Camera")
    camera = bpy.data.objects.new("CAPYBARA_GAME_Camera", camera_data)
    studio.objects.link(camera)
    bpy.context.scene.camera = camera
    add_area_light(studio, "CAPYBARA_GAME_Key", (2.3, -2.5, 3.0), 390, 2.7, (1.0, 0.97, 0.94))
    add_area_light(studio, "CAPYBARA_GAME_Fill", (-2.0, -0.8, 1.7), 230, 2.3, (0.86, 0.91, 1.0))
    add_area_light(studio, "CAPYBARA_GAME_Rim", (0.8, 2.4, 2.5), 230, 2.0, (1.0, 0.91, 0.82))
    return studio, camera


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("CAPYBARA_GAME_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1)
    background.inputs["Strength"].default_value = 0.35
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.render.fps = FPS


def apply_action_pose(
    rig: bpy.types.Object,
    action: bpy.types.Action,
    time_seconds: float,
) -> None:
    rig.animation_data.action = None
    for pose_bone in rig.pose.bones:
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
    rig.animation_data.action = action
    bpy.context.scene.frame_set(round(time_seconds * FPS))


def render_view(
    camera: bpy.types.Object,
    path: Path,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    resolution: tuple[int, int],
    lens: float = 72,
    orthographic_scale: float | None = None,
) -> None:
    camera.location = location
    look_at(camera, Vector(target))
    if orthographic_scale is None:
        camera.data.type = "PERSP"
        camera.data.lens = lens
    else:
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = orthographic_scale
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_previews(
    rig: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
    camera: bpy.types.Object,
) -> None:
    apply_action_pose(rig, actions["capybara_idle_breathe"], 0.0)
    render_view(
        camera,
        PREVIEW_SIDE,
        (3.0, 0.0, 0.38),
        (0.0, 0.0, 0.29),
        (1536, 1024),
        orthographic_scale=1.45,
    )
    render_view(
        camera,
        PREVIEW_THREE_QUARTER,
        (2.1, -2.3, 1.10),
        (0.0, -0.03, 0.29),
        (1400, 1000),
        lens=75,
    )
    render_view(
        camera,
        PREVIEW_FRONT,
        (0.0, -2.45, 0.62),
        (0.0, -0.45, 0.34),
        (1000, 1000),
        lens=90,
    )
    apply_action_pose(rig, actions["capybara_walk"], 0.25)
    render_view(
        camera,
        PREVIEW_WALK,
        (2.0, -2.3, 1.0),
        (0.0, 0.0, 0.26),
        (1200, 900),
        lens=76,
    )
    apply_action_pose(rig, actions["capybara_graze"], 2.5)
    render_view(
        camera,
        PREVIEW_GRAZE,
        (2.0, -2.3, 1.0),
        (0.0, -0.08, 0.22),
        (1200, 900),
        lens=76,
    )
    apply_action_pose(rig, actions["capybara_sit_idle"], 2.5)
    render_view(
        camera,
        PREVIEW_SIT,
        (2.0, -2.3, 1.0),
        (0.0, 0.02, 0.20),
        (1200, 900),
        lens=76,
    )
    apply_action_pose(rig, actions["capybara_idle_breathe"], 0.0)


def audit_asset(
    game_mesh: bpy.types.Object,
    rig: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
) -> dict[str, Any]:
    bm = bmesh.new()
    bm.from_mesh(game_mesh.data)
    nonmanifold = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    influence_counts = [len(vertex.groups) for vertex in game_mesh.data.vertices]
    unweighted = sum(count == 0 for count in influence_counts)
    maximum_influences = max(influence_counts, default=0)
    triangles = sum(max(0, len(poly.vertices) - 2) for poly in game_mesh.data.polygons)
    report = {
        "body_vertices": len(game_mesh.data.vertices),
        "body_triangles": triangles,
        "fur_vertices": 0,
        "fur_triangles": 0,
        "bones": len(rig.data.bones),
        "actions": sorted(actions),
        "unweighted_vertices": unweighted,
        "max_influences": maximum_influences,
        "nonmanifold_edges": nonmanifold,
        "dimensions_blender_m": [round(value, 4) for value in game_mesh.dimensions],
    }
    if unweighted or maximum_influences > 4 or nonmanifold:
        raise RuntimeError(f"Capybara audit failed: {json.dumps(report)}")
    if len(actions) != len(REQUIRED_ACTIONS):
        raise RuntimeError(f"Expected {len(REQUIRED_ACTIONS)} actions: {report}")
    return report


def export_glb(
    path: Path,
    objects: list[bpy.types.Object],
    rig: bpy.types.Object,
    actions: dict[str, bpy.types.Action],
) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    rig.animation_data.action = actions["capybara_idle_breathe"]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_apply=False,
        export_skins=True,
        export_all_influences=False,
        export_def_bones=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_rest_position_armature=True,
        export_draco_mesh_compression_enable=False,
    )


def main() -> None:
    ensure_paths()
    clear_previous()
    configure_scene()
    asset_collection = bpy.data.collections.new("CAPYBARA_GAME_ASSET")
    bpy.context.scene.collection.children.link(asset_collection)

    source = import_source(asset_collection)
    game_mesh = create_game_mesh(source, asset_collection)
    bake_game_textures(game_mesh, create_projection_material())
    rig = create_rig(asset_collection)
    bind_mesh(game_mesh, rig)
    # The projected 2K coat already contains the eye and nostril detail. Separate
    # glossy spheres read as floating props when exported because of bone-space
    # offsets, so the production asset intentionally bakes these into the coat.
    details: list[bpy.types.Object] = []
    actions = create_actions(rig)
    studio, camera = create_studio()
    report = audit_asset(game_mesh, rig, actions)
    render_previews(rig, actions, camera)

    export_objects = [game_mesh, *details]
    export_glb(AUTHORING_GLB, export_objects, rig, actions)
    export_glb(RUNTIME_GLB, export_objects, rig, actions)
    # Save an artist-facing file, not a debug scene: the textured animal is the
    # only visible/selected object on open. Rig and studio remain available in
    # the Outliner and still render/export normally.
    rig.hide_set(True)
    for studio_object in studio.objects:
        studio_object.hide_set(True)
    bpy.ops.object.select_all(action="DESELECT")
    game_mesh.hide_set(False)
    game_mesh.select_set(True)
    bpy.context.view_layer.objects.active = game_mesh
    if bpy.context.screen is not None:
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.shading.type = "MATERIAL"
                area.spaces.active.overlay.show_relationship_lines = False
                area.spaces.active.overlay.show_extras = False
                area.spaces.active.region_3d.view_distance = 1.75
    bpy.ops.wm.save_as_mainfile(filepath=str(TRACKED_BLEND))

    report.update(
        {
            "authoring_glb": str(AUTHORING_GLB),
            "runtime_glb": str(RUNTIME_GLB),
            "tracked_blend": str(TRACKED_BLEND),
            "runtime_glb_bytes": RUNTIME_GLB.stat().st_size,
        }
    )
    print("CAPYBARA_GAME_BUILD=" + json.dumps(report, sort_keys=True))


main()
