"""Build the Shenzhen City capybara from the reviewed reconstruction source.

Run this file inside Blender 5.1 through the official Blender Foundation MCP
connector.  The script deliberately touches only CAPYBARA_* datablocks.
"""

from __future__ import annotations

import bisect
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


SEED = 20260728
TARGET_LENGTH = 1.24
TARGET_WIDTH = 0.46
TARGET_HEIGHT = 0.58
PREVIEW_HAIR_COUNT = 0

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
WORKING_DIR = (
    REPOSITORY_ROOT
    / "SourceAssets"
    / "Models"
    / "Characters"
    / "Working"
    / "Capybara"
)

SOURCE_MESH = SOURCE_DIR / "capybara_reconstruction.obj"
SOURCE_TEXTURE = SOURCE_DIR / "capybara_reconstruction_texture.png"
REFERENCE_IMAGE = SOURCE_DIR / "capybara_reconstruction_reference.png"
PROJECTION_IMAGE = SOURCE_DIR / "capybara_reconstruction_input.png"
FINAL_ALBEDO = SOURCE_DIR / "capybara_final_albedo.png"
WORKING_BLEND = WORKING_DIR / "Capybara.blend"
EXPORT_GLB = EXPORT_DIR / "capybara.glb"
PREVIEW_RENDER = EXPORT_DIR / "capybara_preview.png"
SIDE_RENDER = EXPORT_DIR / "capybara_side.png"
FACE_RENDER = EXPORT_DIR / "capybara_face.png"


def ensure_inputs() -> None:
    missing = [
        path
        for path in (
            SOURCE_MESH,
            SOURCE_TEXTURE,
            REFERENCE_IMAGE,
            PROJECTION_IMAGE,
        )
        if not path.is_file()
    ]
    if missing:
        raise FileNotFoundError(
            "Missing capybara reconstruction source:\n"
            + "\n".join(str(path) for path in missing)
        )
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    WORKING_DIR.mkdir(parents=True, exist_ok=True)


def remove_previous_asset() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith("CAPYBARA_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        if collection.name.startswith("CAPYBARA_"):
            bpy.data.collections.remove(collection)
    for material in list(bpy.data.materials):
        if material.name.startswith("CAPYBARA_"):
            bpy.data.materials.remove(material)
    for curve in list(bpy.data.curves):
        if curve.name.startswith("CAPYBARA_"):
            bpy.data.curves.remove(curve)
    for camera in list(bpy.data.cameras):
        if camera.name.startswith("CAPYBARA_"):
            bpy.data.cameras.remove(camera)
    for light in list(bpy.data.lights):
        if light.name.startswith("CAPYBARA_"):
            bpy.data.lights.remove(light)


def bounds_world(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[i] for point in corners) for i in range(3))),
        Vector(tuple(max(point[i] for point in corners) for i in range(3))),
    )


def create_reconstruction_material() -> bpy.types.Material:
    material = bpy.data.materials.new("CAPYBARA_ReconstructedCoat")
    material.use_nodes = True
    material.diffuse_color = (0.29, 0.13, 0.055, 1.0)
    material.roughness = 0.72

    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    projection = nodes.new("ShaderNodeTexImage")
    coordinates = nodes.new("ShaderNodeTexCoord")
    separate_position = nodes.new("ShaderNodeSeparateXYZ")
    horizontal_map = nodes.new("ShaderNodeMapRange")
    vertical_map = nodes.new("ShaderNodeMapRange")
    projected_coordinates = nodes.new("ShaderNodeCombineXYZ")
    geometry = nodes.new("ShaderNodeNewGeometry")
    separate_normal = nodes.new("ShaderNodeSeparateXYZ")
    absolute_side_normal = nodes.new("ShaderNodeMath")
    side_blend = nodes.new("ShaderNodeValToRGB")
    coat_mix = nodes.new("ShaderNodeMixRGB")
    noise = nodes.new("ShaderNodeTexNoise")
    bump = nodes.new("ShaderNodeBump")

    texture.image = bpy.data.images.load(str(SOURCE_TEXTURE), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB"
    texture.interpolation = "Linear"
    texture.extension = "EXTEND"
    projection.image = bpy.data.images.load(
        str(PROJECTION_IMAGE), check_existing=True
    )
    projection.image.colorspace_settings.name = "sRGB"
    projection.interpolation = "Linear"
    projection.extension = "EXTEND"

    # The background-removal plate places the animal inside this measured UV
    # rectangle.  The reconstruction faces +X, while the plate faces left, so
    # the horizontal mapping is intentionally reversed.
    horizontal_map.inputs["From Min"].default_value = 0.0
    horizontal_map.inputs["From Max"].default_value = 1.0
    horizontal_map.inputs["To Min"].default_value = 0.933507
    horizontal_map.inputs["To Max"].default_value = 0.066493
    horizontal_map.clamp = True
    vertical_map.inputs["From Min"].default_value = 0.0
    vertical_map.inputs["From Max"].default_value = 1.0
    vertical_map.inputs["To Min"].default_value = 0.241851
    vertical_map.inputs["To Max"].default_value = 0.758149
    vertical_map.clamp = True

    absolute_side_normal.operation = "ABSOLUTE"
    side_blend.color_ramp.elements[0].position = 0.28
    side_blend.color_ramp.elements[1].position = 0.72
    side_blend.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    side_blend.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    coat_mix.blend_type = "MIX"

    principled.inputs["Roughness"].default_value = 0.74
    principled.inputs["IOR"].default_value = 1.46
    principled.inputs["Specular IOR Level"].default_value = 0.28
    principled.inputs["Subsurface Weight"].default_value = 0.018

    noise.inputs["Scale"].default_value = 235.0
    noise.inputs["Detail"].default_value = 3.8
    noise.inputs["Roughness"].default_value = 0.78
    noise.inputs["Distortion"].default_value = 0.12
    bump.inputs["Strength"].default_value = 0.19
    bump.inputs["Distance"].default_value = 0.0018

    links.new(coordinates.outputs["Generated"], separate_position.inputs["Vector"])
    links.new(separate_position.outputs["X"], horizontal_map.inputs["Value"])
    links.new(separate_position.outputs["Z"], vertical_map.inputs["Value"])
    links.new(horizontal_map.outputs["Result"], projected_coordinates.inputs["X"])
    links.new(vertical_map.outputs["Result"], projected_coordinates.inputs["Y"])
    links.new(projected_coordinates.outputs["Vector"], projection.inputs["Vector"])
    links.new(geometry.outputs["Normal"], separate_normal.inputs["Vector"])
    links.new(separate_normal.outputs["Y"], absolute_side_normal.inputs[0])
    links.new(absolute_side_normal.outputs[0], side_blend.inputs["Fac"])
    links.new(side_blend.outputs["Color"], coat_mix.inputs["Fac"])
    links.new(texture.outputs["Color"], coat_mix.inputs[1])
    links.new(projection.outputs["Color"], coat_mix.inputs[2])
    links.new(coat_mix.outputs["Color"], principled.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def import_and_prepare_mesh(
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(
        filepath=str(SOURCE_MESH),
        forward_axis="Y",
        up_axis="Z",
        use_split_objects=False,
        use_split_groups=False,
        validate_meshes=True,
    )
    imported = [obj for obj in bpy.data.objects if obj not in before]
    mesh_objects = [obj for obj in imported if obj.type == "MESH"]
    if not mesh_objects:
        raise RuntimeError("The reconstruction OBJ produced no Blender mesh")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
        if obj.name not in collection.objects:
            for owner in list(obj.users_collection):
                owner.objects.unlink(obj)
            collection.objects.link(obj)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    if len(mesh_objects) > 1:
        bpy.ops.object.join()

    animal = bpy.context.view_layer.objects.active
    animal.name = "CAPYBARA_RenderMesh"
    animal.data.name = "CAPYBARA_ReconstructedMesh"

    minimum, maximum = bounds_world(animal)
    dimensions = maximum - minimum
    if min(dimensions) <= 0:
        raise RuntimeError(f"Invalid source bounds: {tuple(dimensions)}")

    # TripoSR source axes are X=width, Y=length, Z=height.  Rotate the
    # left-facing source so the capybara's anatomical forward direction is +X.
    animal.scale = (
        TARGET_WIDTH / dimensions.x,
        TARGET_LENGTH / dimensions.y,
        TARGET_HEIGHT / dimensions.z,
    )
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    animal.rotation_euler.z = math.radians(90.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

    minimum, maximum = bounds_world(animal)
    animal.location -= Vector(
        ((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, minimum.z)
    )
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    for polygon in animal.data.polygons:
        polygon.use_smooth = True

    material = create_reconstruction_material()
    animal.data.materials.clear()
    animal.data.materials.append(material)
    animal["asset_role"] = "high-detail render mesh"
    animal["source_model"] = "TripoSR"
    animal["source_model_commit"] = "107cefdc244c39106fa830359024f6a2f1c78871"
    animal["source_reference"] = REFERENCE_IMAGE.relative_to(
        REPOSITORY_ROOT
    ).as_posix()
    animal["real_world_length_m"] = TARGET_LENGTH
    animal["real_world_width_m"] = TARGET_WIDTH
    animal["real_world_height_m"] = TARGET_HEIGHT
    return animal


def bake_final_albedo(
    animal: bpy.types.Object,
    material: bpy.types.Material,
) -> None:
    """Bake the side projection and reconstructed fallback into portable UVs."""

    scene = bpy.context.scene
    nodes = material.node_tree.nodes
    target = nodes.new("ShaderNodeTexImage")
    target.name = "CAPYBARA_FinalAlbedoBakeTarget"
    target.image = bpy.data.images.new(
        "CAPYBARA_FinalAlbedo",
        width=2048,
        height=2048,
        alpha=False,
        float_buffer=False,
    )
    target.image.generated_color = (0.12, 0.055, 0.02, 1.0)
    for node in nodes:
        node.select = False
    target.select = True
    nodes.active = target

    bpy.ops.object.select_all(action="DESELECT")
    animal.select_set(True)
    bpy.context.view_layer.objects.active = animal
    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.margin = 8
    bpy.ops.object.bake(
        type="DIFFUSE",
        pass_filter={"COLOR"},
        use_clear=True,
        margin=8,
    )
    target.image.filepath_raw = str(FINAL_ALBEDO)
    target.image.file_format = "PNG"
    target.image.save()
    scene.render.engine = previous_engine

    baked_image = target.image
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    albedo = nodes.new("ShaderNodeTexImage")
    noise = nodes.new("ShaderNodeTexNoise")
    bump = nodes.new("ShaderNodeBump")
    albedo.image = baked_image
    albedo.image.colorspace_settings.name = "sRGB"
    albedo.interpolation = "Linear"
    albedo.extension = "EXTEND"
    principled.inputs["Roughness"].default_value = 0.76
    principled.inputs["IOR"].default_value = 1.46
    principled.inputs["Specular IOR Level"].default_value = 0.25
    principled.inputs["Subsurface Weight"].default_value = 0.012
    noise.inputs["Scale"].default_value = 260.0
    noise.inputs["Detail"].default_value = 3.4
    noise.inputs["Roughness"].default_value = 0.8
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.0014
    links = material.node_tree.links
    links.new(albedo.outputs["Color"], principled.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])


def create_preview_hair(
    animal: bpy.types.Object,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    """Create coarse guard hairs for Blender portraits only.

    glTF receives the baked coat texture; the curve object stays in the
    editable .blend so the portable asset remains reasonably sized.
    """

    mesh = animal.data
    mesh.calc_loop_triangles()
    candidates = []
    cumulative_area = []
    total_area = 0.0
    for triangle in mesh.loop_triangles:
        center = sum((mesh.vertices[i].co for i in triangle.vertices), Vector()) / 3
        if center.z < 0.105:
            continue
        total_area += triangle.area
        candidates.append(triangle)
        cumulative_area.append(total_area)

    if not candidates:
        raise RuntimeError("No surface triangles available for preview guard hair")

    rng = random.Random(SEED)
    curve_data = bpy.data.curves.new("CAPYBARA_PreviewGuardHair", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 1
    curve_data.bevel_depth = 0.00032
    curve_data.bevel_resolution = 0
    curve_data.resolution_u = 1

    for _ in range(PREVIEW_HAIR_COUNT):
        triangle = candidates[
            bisect.bisect_left(cumulative_area, rng.random() * total_area)
        ]
        v0, v1, v2 = (mesh.vertices[i] for i in triangle.vertices)
        r1 = math.sqrt(rng.random())
        r2 = rng.random()
        weights = (1.0 - r1, r1 * (1.0 - r2), r1 * r2)
        root = v0.co * weights[0] + v1.co * weights[1] + v2.co * weights[2]
        normal = (
            v0.normal * weights[0]
            + v1.normal * weights[1]
            + v2.normal * weights[2]
        ).normalized()
        flow = (normal * 0.88 + Vector((-0.22, 0.0, -0.035))).normalized()
        length = rng.uniform(0.009, 0.021)

        strand = curve_data.splines.new("POLY")
        strand.points.add(1)
        strand.points[0].co = (*((root + normal * 0.0004)), 1.0)
        strand.points[1].co = (*((root + flow * length)), 1.0)

    hair = bpy.data.objects.new("CAPYBARA_PreviewGuardHair", curve_data)
    collection.objects.link(hair)
    hair_material = bpy.data.materials.new("CAPYBARA_GuardHairMaterial")
    hair_material.diffuse_color = (0.13, 0.052, 0.018, 1.0)
    hair_material.use_nodes = True
    hair_principled = hair_material.node_tree.nodes.get("Principled BSDF")
    hair_principled.inputs["Base Color"].default_value = (0.10, 0.035, 0.012, 1)
    hair_principled.inputs["Roughness"].default_value = 0.8
    curve_data.materials.append(hair_material)
    hair["asset_role"] = "Blender portrait guard hair; excluded from glTF"
    return hair


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    energy: float,
    size: float,
    color: tuple[float, float, float],
) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    look_at(obj, Vector((0.0, 0.0, 0.3)))
    return obj


def create_studio() -> tuple[bpy.types.Collection, bpy.types.Object]:
    studio = bpy.data.collections.new("CAPYBARA_STUDIO")
    bpy.context.scene.collection.children.link(studio)

    bpy.ops.mesh.primitive_plane_add(size=20.0, location=(0.0, 0.0, -0.004))
    ground = bpy.context.object
    ground.name = "CAPYBARA_StudioGround"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    studio.objects.link(ground)
    ground_material = bpy.data.materials.new("CAPYBARA_StudioGroundMaterial")
    ground_material.diffuse_color = (0.055, 0.062, 0.055, 1.0)
    ground_material.roughness = 0.91
    ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("CAPYBARA_Camera")
    camera = bpy.data.objects.new("CAPYBARA_Camera", camera_data)
    studio.objects.link(camera)
    camera.data.lens = 68
    camera.data.sensor_width = 36
    bpy.context.scene.camera = camera

    add_area_light(
        studio,
        "CAPYBARA_Key",
        (2.4, 2.6, 3.3),
        260,
        2.8,
        (1.0, 0.82, 0.67),
    )
    add_area_light(
        studio,
        "CAPYBARA_Fill",
        (-2.1, 1.5, 1.8),
        150,
        2.4,
        (0.64, 0.77, 1.0),
    )
    add_area_light(
        studio,
        "CAPYBARA_Rim",
        (-1.4, -2.4, 2.7),
        220,
        2.0,
        (1.0, 0.55, 0.29),
    )
    return studio, camera


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 20
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.028, 0.023, 0.019, 1.0)
    background.inputs["Strength"].default_value = 0.28
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"


def render_view(
    camera: bpy.types.Object,
    path: Path,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    lens: float,
    resolution: tuple[int, int],
) -> None:
    scene = bpy.context.scene
    camera.location = location
    camera.data.lens = lens
    look_at(camera, Vector(target))
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def export_asset(animal: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    animal.select_set(True)
    bpy.context.view_layer.objects.active = animal
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT_GLB),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )


def main() -> None:
    ensure_inputs()
    remove_previous_asset()
    configure_scene()

    asset_collection = bpy.data.collections.new("CAPYBARA_ASSET")
    bpy.context.scene.collection.children.link(asset_collection)
    animal = import_and_prepare_mesh(asset_collection)
    bake_final_albedo(animal, animal.data.materials[0])
    if PREVIEW_HAIR_COUNT:
        create_preview_hair(animal, asset_collection)
    _, camera = create_studio()

    render_view(
        camera,
        PREVIEW_RENDER,
        (2.0, 2.45, 1.18),
        (0.05, 0.0, 0.30),
        72,
        (1400, 1000),
    )
    render_view(
        camera,
        SIDE_RENDER,
        (0.0, 2.9, 0.62),
        (0.0, 0.0, 0.29),
        76,
        (1400, 850),
    )
    render_view(
        camera,
        FACE_RENDER,
        (2.45, 0.0, 0.66),
        (0.50, 0.0, 0.32),
        88,
        (1000, 1000),
    )

    export_asset(animal)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORKING_BLEND))
    print(
        {
            "blend": str(WORKING_BLEND),
            "glb": str(EXPORT_GLB),
            "preview": str(PREVIEW_RENDER),
            "side": str(SIDE_RENDER),
            "face": str(FACE_RENDER),
            "render_mesh_vertices": len(animal.data.vertices),
            "render_mesh_triangles": len(animal.data.loop_triangles),
            "preview_hairs": PREVIEW_HAIR_COUNT,
            "dimensions_m": tuple(round(value, 4) for value in animal.dimensions),
        }
    )


main()
