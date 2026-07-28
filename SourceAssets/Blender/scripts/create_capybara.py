"""Build and present the Shenron City capybara character asset.

Designed for execution through Blender Foundation's official MCP connector.
The script is deterministic and idempotent: it replaces only collections whose
names start with ``CAPYBARA_`` and preserves every unrelated scene object.
"""

from __future__ import annotations

import bisect
import math
import random
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


SEED = 20260728
ASSET_COLLECTION = "CAPYBARA_ASSET"
PRESENTATION_COLLECTION = "CAPYBARA_PRESENTATION"
BODY_COLLECTION = "10_Body"
DETAIL_COLLECTION = "20_Face_and_Paws"
FUR_COLLECTION = "30_Fur_and_Whiskers"
HAIR_COUNT = 28_000

SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[3]
WORKING_DIR = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Characters"
    / "Working"
    / "Capybara"
)
EXPORT_DIR = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Characters"
    / "Exports"
    / "Capybara"
)
ASSET_BLEND_PATH = WORKING_DIR / "Capybara.blend"
PREVIEW_PATH = EXPORT_DIR / "capybara_preview.png"
PORTABLE_GLB_PATH = EXPORT_DIR / "capybara.glb"


def remove_collection(name: str) -> None:
    collection = bpy.data.collections.get(name)
    if collection is None:
        return
    for child in list(collection.children):
        remove_collection(child.name)
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def remove_generated_datablocks() -> None:
    for datablocks in (
        bpy.data.materials,
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.textures,
    ):
        for datablock in list(datablocks):
            if datablock.name.startswith("CAPY_") and datablock.users == 0:
                datablocks.remove(datablock)


def new_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    return collection


def move_to_collection(
    obj: bpy.types.Object,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def set_principled_input(
    shader: bpy.types.ShaderNodeBsdfPrincipled,
    name: str,
    value: object,
) -> None:
    socket = shader.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def material_body() -> bpy.types.Material:
    material = bpy.data.materials.new("CAPY_MAT_Fur_Base")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    ramp = nodes.new("ShaderNodeValToRGB")
    bump = nodes.new("ShaderNodeBump")

    noise.inputs["Scale"].default_value = 6.5
    noise.inputs["Detail"].default_value = 7.0
    noise.inputs["Roughness"].default_value = 0.72
    ramp.color_ramp.elements[0].position = 0.20
    ramp.color_ramp.elements[0].color = (0.014, 0.007, 0.003, 1.0)
    ramp.color_ramp.elements[1].position = 0.82
    ramp.color_ramp.elements[1].color = (0.145, 0.062, 0.019, 1.0)
    middle = ramp.color_ramp.elements.new(0.52)
    middle.color = (0.056, 0.023, 0.007, 1.0)
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.025

    set_principled_input(shader, "Roughness", 0.58)
    set_principled_input(shader, "Specular IOR Level", 0.28)
    set_principled_input(shader, "Coat Weight", 0.05)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def material_fur() -> bpy.types.Material:
    material = bpy.data.materials.new("CAPY_MAT_Dense_Fur")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    hair_info = nodes.new("ShaderNodeHairInfo")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.006, 0.0025, 0.001, 1.0)
    ramp.color_ramp.elements[0].position = 0.10
    ramp.color_ramp.elements[1].color = (0.18, 0.072, 0.018, 1.0)
    ramp.color_ramp.elements[1].position = 0.90
    middle = ramp.color_ramp.elements.new(0.56)
    middle.color = (0.045, 0.016, 0.004, 1.0)
    set_principled_input(shader, "Roughness", 0.72)
    set_principled_input(shader, "Specular IOR Level", 0.18)
    links.new(hair_info.outputs["Random"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def material_simple(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
    transmission: float = 0.0,
    ior: float = 1.45,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    assert isinstance(shader, bpy.types.ShaderNodeBsdfPrincipled)
    set_principled_input(shader, "Base Color", color)
    set_principled_input(shader, "Roughness", roughness)
    set_principled_input(shader, "Metallic", metallic)
    set_principled_input(shader, "Transmission Weight", transmission)
    set_principled_input(shader, "IOR", ior)
    return material


def add_uv_ellipsoid(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    collection: bpy.types.Collection,
    material: bpy.types.Material | None = None,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 32,
    rings: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    assert obj is not None
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    if material is not None:
        obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_body(
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    pieces = [
        add_uv_ellipsoid(
            "CAPY_Body_Core",
            (-0.20, 0.0, 1.02),
            (1.28, 0.58, 0.62),
            collection,
            material,
        ),
        add_uv_ellipsoid(
            "CAPY_Haunches",
            (-0.92, 0.0, 0.92),
            (0.62, 0.55, 0.57),
            collection,
            material,
        ),
        add_uv_ellipsoid(
            "CAPY_Chest",
            (0.65, 0.0, 1.10),
            (0.62, 0.53, 0.62),
            collection,
            material,
        ),
        add_uv_ellipsoid(
            "CAPY_Neck",
            (0.88, 0.0, 1.27),
            (0.48, 0.46, 0.54),
            collection,
            material,
        ),
        add_uv_ellipsoid(
            "CAPY_Head",
            (1.28, 0.0, 1.42),
            (0.60, 0.45, 0.48),
            collection,
            material,
            rotation=(0.0, -0.10, 0.0),
        ),
        add_uv_ellipsoid(
            "CAPY_Muzzle",
            (1.70, 0.0, 1.29),
            (0.48, 0.38, 0.31),
            collection,
            material,
            rotation=(0.0, -0.05, 0.0),
        ),
        add_uv_ellipsoid(
            "CAPY_Jaw",
            (1.55, 0.0, 1.17),
            (0.38, 0.34, 0.26),
            collection,
            material,
        ),
    ]

    for index, (x_value, y_value) in enumerate(
        ((-0.80, -0.36), (-0.80, 0.36), (0.57, -0.36), (0.57, 0.36))
    ):
        pieces.append(
            add_uv_ellipsoid(
                f"CAPY_Leg_{index + 1:02d}",
                (x_value, y_value, 0.48),
                (0.20, 0.18, 0.48),
                collection,
                material,
                rotation=(0.0, (-0.08 if x_value < 0 else 0.10), 0.0),
            )
        )
        pieces.append(
            add_uv_ellipsoid(
                f"CAPY_Paw_{index + 1:02d}",
                (x_value + 0.09, y_value, 0.16),
                (0.25, 0.19, 0.14),
                collection,
                material,
            )
        )

    bpy.ops.object.select_all(action="DESELECT")
    for piece in pieces:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    assert body is not None
    body.name = "CAPY_Body"

    remesh = body.modifiers.new("CAPY_Organic_Fusion", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = 0.045
    remesh.use_smooth_shade = True
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=remesh.name)

    smooth = body.modifiers.new("CAPY_Organic_Smoothing", "SMOOTH")
    smooth.factor = 0.72
    smooth.iterations = 5
    bpy.ops.object.modifier_apply(modifier=smooth.name)

    texture = bpy.data.textures.new("CAPY_Skin_Microvariation", type="CLOUDS")
    texture.noise_scale = 0.14
    texture.noise_depth = 2
    displacement = body.modifiers.new("CAPY_Skin_Microvariation", "DISPLACE")
    displacement.texture = texture
    displacement.strength = 0.018
    displacement.mid_level = 0.50
    bpy.ops.object.modifier_apply(modifier=displacement.name)

    subdivision = body.modifiers.new("CAPY_Subdivision", "SUBSURF")
    subdivision.subdivision_type = "CATMULL_CLARK"
    subdivision.levels = 1
    subdivision.render_levels = 2
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    return body


def add_torus(
    name: str,
    location: tuple[float, float, float],
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    major_radius: float,
    minor_radius: float,
    rotation: tuple[float, float, float],
    scale: tuple[float, float, float],
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=32,
        minor_segments=8,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    assert obj is not None
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_face_and_paws(
    collection: bpy.types.Collection,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    objects: list[bpy.types.Object] = []

    for side, sign in (("L", -1.0), ("R", 1.0)):
        ear = add_uv_ellipsoid(
            f"CAPY_Ear_{side}",
            (1.10, sign * 0.405, 1.73),
            (0.115, 0.048, 0.125),
            collection,
            materials["body"],
            rotation=(0.04, sign * -0.20, sign * 0.10),
        )
        inner = add_uv_ellipsoid(
            f"CAPY_Ear_Inner_{side}",
            (1.115, sign * 0.438, 1.735),
            (0.072, 0.018, 0.078),
            collection,
            materials["inner_ear"],
            rotation=(0.04, sign * -0.20, sign * 0.10),
            segments=24,
            rings=16,
        )
        brow = add_uv_ellipsoid(
            f"CAPY_Brow_{side}",
            (1.42, sign * 0.390, 1.61),
            (0.16, 0.045, 0.060),
            collection,
            materials["body"],
            rotation=(sign * 0.12, 0.0, 0.0),
            segments=24,
            rings=16,
        )
        eye = add_uv_ellipsoid(
            f"CAPY_Eye_{side}",
            (1.49, sign * 0.424, 1.535),
            (0.047, 0.025, 0.047),
            collection,
            materials["eye"],
            segments=32,
            rings=20,
        )
        cornea = add_uv_ellipsoid(
            f"CAPY_Cornea_{side}",
            (1.49, sign * 0.443, 1.535),
            (0.050, 0.016, 0.050),
            collection,
            materials["cornea"],
            segments=32,
            rings=20,
        )
        lid = add_torus(
            f"CAPY_Eyelid_{side}",
            (1.49, sign * 0.442, 1.535),
            collection,
            materials["body"],
            major_radius=0.052,
            minor_radius=0.004,
            rotation=(math.pi / 2.0, 0.0, 0.0),
            scale=(1.0, 1.0, 0.86),
        )
        objects.extend((ear, inner, brow, eye, cornea, lid))

        nostril = add_uv_ellipsoid(
            f"CAPY_Nostril_{side}",
            (2.085, sign * 0.160, 1.335),
            (0.020, 0.045, 0.029),
            collection,
            materials["nose"],
            rotation=(0.0, 0.0, sign * 0.10),
            segments=24,
            rings=16,
        )
        objects.append(nostril)

    for foot_index, (x_value, y_value) in enumerate(
        ((-0.71, -0.36), (-0.71, 0.36), (0.66, -0.36), (0.66, 0.36))
    ):
        for toe_index, lateral in enumerate((-0.11, 0.0, 0.11)):
            bpy.ops.mesh.primitive_cone_add(
                vertices=20,
                radius1=0.034,
                radius2=0.006,
                depth=0.13,
                location=(x_value + 0.28, y_value + lateral, 0.145),
                rotation=(0.0, math.pi / 2.0, 0.0),
            )
            claw = bpy.context.active_object
            assert claw is not None
            claw.name = f"CAPY_Claw_{foot_index + 1:02d}_{toe_index + 1:02d}"
            move_to_collection(claw, collection)
            claw.data.materials.append(materials["claw"])
            for polygon in claw.data.polygons:
                polygon.use_smooth = True
            objects.append(claw)

    return objects


def add_poly_curve(
    name: str,
    splines: Iterable[list[tuple[Vector, float]]],
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    bevel_depth: float,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name=f"{name}_Data", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.resolution_v = 0
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 0
    curve.use_fill_caps = True
    curve.materials.append(material)

    for points in splines:
        spline = curve.splines.new("POLY")
        spline.points.add(len(points) - 1)
        for point, (position, radius) in zip(spline.points, points):
            point.co = (*position, 1.0)
            point.radius = radius

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    return obj


def triangle_samples(
    body: bpy.types.Object,
    count: int,
    rng: random.Random,
) -> list[tuple[Vector, Vector]]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    try:
        mesh.calc_loop_triangles()
        triangles = list(mesh.loop_triangles)
        areas = [triangle.area for triangle in triangles]
        cumulative: list[float] = []
        total = 0.0
        for area in areas:
            total += area
            cumulative.append(total)

        samples: list[tuple[Vector, Vector]] = []
        attempts = 0
        while len(samples) < count and attempts < count * 3:
            attempts += 1
            triangle = triangles[
                min(bisect.bisect_left(cumulative, rng.random() * total), len(triangles) - 1)
            ]
            vertices = [mesh.vertices[index] for index in triangle.vertices]
            root = math.sqrt(rng.random())
            second = rng.random()
            weights = (1.0 - root, root * (1.0 - second), root * second)
            position = sum(
                (vertex.co * weight for vertex, weight in zip(vertices, weights)),
                Vector(),
            )
            normal = sum(
                (vertex.normal * weight for vertex, weight in zip(vertices, weights)),
                Vector(),
            ).normalized()
            if normal.z < -0.55:
                continue
            samples.append(
                (
                    evaluated.matrix_world @ position,
                    (evaluated.matrix_world.to_3x3() @ normal).normalized(),
                )
            )
        return samples
    finally:
        evaluated.to_mesh_clear()


def add_fur(
    body: bpy.types.Object,
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    rng: random.Random,
) -> bpy.types.Object:
    strands: list[list[tuple[Vector, float]]] = []
    for position, normal in triangle_samples(body, HAIR_COUNT, rng):
        random_vector = Vector(
            (rng.uniform(-1.0, 1.0), rng.uniform(-1.0, 1.0), rng.uniform(-0.5, 0.8))
        )
        coat_flow = Vector((-1.0, rng.uniform(-0.16, 0.16), -0.08))
        flow_strength = 0.30 if position.x > 1.0 else 0.50
        direction = (
            normal * 0.88 + coat_flow * flow_strength + random_vector * 0.075
        ).normalized()
        head_factor = 0.74 if position.x > 0.85 else 1.0
        length = rng.uniform(0.032, 0.058) * head_factor
        root = position + normal * 0.002
        bend = Vector((0.0, rng.uniform(-0.010, 0.010), rng.uniform(-0.006, 0.010)))
        strands.append(
            [
                (root, 1.0),
                (root + direction * (length * 0.55) + bend, 0.65),
                (root + direction * length + bend * 1.6, 0.06),
            ]
        )
    return add_poly_curve(
        "CAPY_Dense_Tapered_Fur",
        strands,
        collection,
        material,
        bevel_depth=0.0018,
    )


def add_whiskers(
    collection: bpy.types.Collection,
    material: bpy.types.Material,
    rng: random.Random,
) -> bpy.types.Object:
    whiskers: list[list[tuple[Vector, float]]] = []
    for sign in (-1.0, 1.0):
        for index in range(13):
            root = Vector(
                (
                    rng.uniform(1.72, 1.98),
                    sign * rng.uniform(0.29, 0.35),
                    rng.uniform(1.20, 1.40),
                )
            )
            length = rng.uniform(0.25, 0.47)
            direction = Vector(
                (
                    rng.uniform(-0.15, 0.45),
                    sign * rng.uniform(0.80, 1.0),
                    rng.uniform(-0.20, 0.26),
                )
            ).normalized()
            whiskers.append(
                [
                    (root, 1.0),
                    (root + direction * (length * 0.55) + Vector((0, 0, -0.012)), 0.52),
                    (root + direction * length + Vector((0, 0, -0.035)), 0.04),
                ]
            )
    return add_poly_curve(
        "CAPY_Whiskers",
        whiskers,
        collection,
        material,
        bevel_depth=0.0015,
    )


def add_mouth(
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    points = [
        (Vector((1.94, -0.22, 1.185)), 0.70),
        (Vector((2.075, -0.08, 1.175)), 0.90),
        (Vector((2.105, 0.00, 1.172)), 1.00),
        (Vector((2.075, 0.08, 1.175)), 0.90),
        (Vector((1.94, 0.22, 1.185)), 0.70),
    ]
    return add_poly_curve(
        "CAPY_Mouth_Line",
        [points],
        collection,
        material,
        bevel_depth=0.006,
    )


def aim_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float,
    collection: bpy.types.Collection,
    target: Vector,
) -> bpy.types.Object:
    data = bpy.data.lights.new(name=f"{name}_Data", type="AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    aim_at(obj, target)
    return obj


def add_presentation(
    collection: bpy.types.Collection,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Camera:
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, 0.0))
    floor = bpy.context.active_object
    assert floor is not None
    floor.name = "CAPY_Studio_Ground"
    move_to_collection(floor, collection)
    floor.data.materials.append(materials["ground"])

    target = Vector((0.35, 0.0, 1.03))
    add_area_light(
        "CAPY_Key_Light",
        (4.6, -4.2, 5.8),
        930.0,
        (1.0, 0.88, 0.76),
        4.0,
        collection,
        target,
    )
    add_area_light(
        "CAPY_Fill_Light",
        (1.2, 4.5, 3.3),
        680.0,
        (0.62, 0.74, 1.0),
        3.5,
        collection,
        target,
    )
    add_area_light(
        "CAPY_Rim_Light",
        (-4.2, -1.2, 4.3),
        760.0,
        (1.0, 0.68, 0.48),
        3.0,
        collection,
        target,
    )

    camera_data = bpy.data.cameras.new("CAPY_Preview_Camera_Data")
    camera = bpy.data.objects.new("CAPY_Preview_Camera", camera_data)
    collection.objects.link(camera)
    camera.location = (5.0, -6.4, 2.85)
    camera.data.lens = 62.0
    camera.data.sensor_width = 36.0
    camera.data.dof.use_dof = True
    camera.data.dof.aperture_fstop = 3.4
    focus = bpy.data.objects.new("CAPY_Focus", None)
    focus.empty_display_type = "SPHERE"
    focus.empty_display_size = 0.08
    focus.location = target
    collection.objects.link(focus)
    camera.data.dof.focus_object = focus
    aim_at(camera, target)
    return camera.data


def hide_unrelated_scene_objects(
    asset: bpy.types.Collection,
    presentation: bpy.types.Collection,
) -> None:
    allowed = set(asset.all_objects) | set(presentation.all_objects)
    for obj in bpy.context.scene.objects:
        if obj not in allowed and not obj.name.startswith("CAPY_"):
            obj.hide_render = True


def configure_render(camera_data: bpy.types.Camera) -> None:
    scene = bpy.context.scene
    camera_object = next(
        obj for obj in bpy.data.objects if obj.type == "CAMERA" and obj.data == camera_data
    )
    scene.camera = camera_object
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 4
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.color = (0.008, 0.010, 0.014)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass


def main() -> dict[str, object]:
    rng = random.Random(SEED)
    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    remove_collection(ASSET_COLLECTION)
    remove_collection(PRESENTATION_COLLECTION)
    remove_generated_datablocks()

    scene_root = bpy.context.scene.collection
    city_root = bpy.data.collections.get("SHENRON_CITY")
    character_parent = bpy.data.collections.get("40_Characters")
    asset_parent = character_parent or city_root or scene_root
    reference_parent = bpy.data.collections.get("00_References") or city_root or scene_root

    asset = new_collection(ASSET_COLLECTION, asset_parent)
    body_collection = new_collection(BODY_COLLECTION, asset)
    detail_collection = new_collection(DETAIL_COLLECTION, asset)
    fur_collection = new_collection(FUR_COLLECTION, asset)
    presentation = new_collection(PRESENTATION_COLLECTION, reference_parent)

    materials = {
        "body": material_body(),
        "fur": material_fur(),
        "eye": material_simple("CAPY_MAT_Eye", (0.004, 0.002, 0.001, 1.0), 0.12),
        "cornea": material_simple(
            "CAPY_MAT_Cornea",
            (0.012, 0.018, 0.020, 1.0),
            0.035,
            transmission=0.72,
            ior=1.40,
        ),
        "lid": material_simple("CAPY_MAT_Eyelid", (0.030, 0.009, 0.004, 1.0), 0.48),
        "inner_ear": material_simple(
            "CAPY_MAT_Inner_Ear",
            (0.048, 0.012, 0.009, 1.0),
            0.62,
        ),
        "nose": material_simple("CAPY_MAT_Nostrils", (0.006, 0.003, 0.002, 1.0), 0.66),
        "claw": material_simple("CAPY_MAT_Claws", (0.045, 0.032, 0.020, 1.0), 0.38),
        "whisker": material_simple("CAPY_MAT_Whiskers", (0.020, 0.015, 0.010, 1.0), 0.30),
        "ground": material_simple("CAPY_MAT_Ground", (0.055, 0.060, 0.068, 1.0), 0.74),
    }

    body = add_body(body_collection, materials["body"])
    details = add_face_and_paws(detail_collection, materials)
    fur = add_fur(body, fur_collection, materials["fur"], rng)
    whiskers = add_whiskers(fur_collection, materials["whisker"], rng)
    mouth = add_mouth(detail_collection, materials["lid"])

    asset["asset_name"] = "Capybara"
    asset["asset_type"] = "character"
    asset["authoring_units"] = "metres"
    asset["forward_axis"] = "+X"
    asset["license"] = "Original procedural asset for Shenron City"
    asset["generator"] = str(SCRIPT_PATH)
    asset["seed"] = SEED
    asset["fur_strands"] = HAIR_COUNT

    camera_data = add_presentation(presentation, materials)
    hide_unrelated_scene_objects(asset, presentation)
    configure_render(camera_data)

    bpy.context.scene["shenron_capybara_asset"] = str(ASSET_BLEND_PATH)
    bpy.context.scene["shenron_capybara_preview"] = str(PREVIEW_PATH)
    bpy.context.scene["shenron_capybara_glb"] = str(PORTABLE_GLB_PATH)

    bpy.data.libraries.write(
        str(ASSET_BLEND_PATH),
        {asset},
        path_remap="RELATIVE",
        fake_user=True,
        compress=True,
    )

    bpy.ops.object.select_all(action="DESELECT")
    for obj in asset.all_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(
        filepath=str(PORTABLE_GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )

    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_mainfile()

    return {
        "asset_collection": asset.name,
        "body_vertices": len(body.data.vertices),
        "detail_objects": len(details) + 1,
        "fur_strands": len(fur.data.splines),
        "whiskers": len(whiskers.data.splines),
        "mouth_splines": len(mouth.data.splines),
        "asset_blend": str(ASSET_BLEND_PATH),
        "portable_glb": str(PORTABLE_GLB_PATH),
        "preview": str(PREVIEW_PATH),
    }


if __name__ == "__main__":
    print(main())
