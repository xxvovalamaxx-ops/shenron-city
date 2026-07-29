"""Create an original, repository-safe Japanese forest shrine scene.

All geometry, materials, lighting, and scattering in this file are generated
from project-owned code. No third-party mesh, texture, HDRI, or scan is used.
The visual reference informs only the broad composition and atmosphere.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
BLEND_PATH = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Working"
    / "Japanese_Forest_Shrine_Original_CC0.blend"
)
PREVIEW_PATH = (
    ROOT
    / "docs"
    / "Assets"
    / "Previews"
    / "japanese-forest-shrine-original.png"
)

random.seed(92341)


def clean_scene() -> bpy.types.Scene:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for existing_collection in list(bpy.data.collections):
        bpy.data.collections.remove(existing_collection)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.node_groups,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    # Keep the published source self-contained. Blender can preload linked
    # Essentials brushes into a fresh session even though this generator does
    # not use them; remove those incidental library references before saving.
    for brush in list(bpy.data.brushes):
        if brush.library is not None or brush.users == 0:
            bpy.data.brushes.remove(brush)
    for palette in list(bpy.data.palettes):
        if palette.library is not None or palette.users == 0:
            bpy.data.palettes.remove(palette)
    for library in list(bpy.data.libraries):
        bpy.data.libraries.remove(library)

    scene = bpy.context.scene
    scene.name = "Japanese_Forest_Shrine_CC0"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["asset_id"] = "environment.japanese_forest_shrine.original.v1"
    scene["asset_license"] = "CC0-1.0"
    scene["asset_author"] = "Shenzhen City project"
    scene["asset_provenance"] = (
        "Original procedural Blender work. No external meshes, textures, "
        "scans, HDRIs, or restricted assets."
    )
    scene["reference_scope"] = (
        "User-supplied image used only for broad composition: forested shrine, "
        "stone stairs, lanterns, guardian statues, and cinematic daylight."
    )
    return scene


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    target = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(target)
    return target


def move_to_collection(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def material(
    name: str,
    base_color: tuple[float, float, float, float],
    roughness: float,
    *,
    metallic: float = 0.0,
    noise_scale: float | None = None,
    noise_strength: float = 0.25,
    bump_strength: float = 0.2,
    emission_color: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = base_color
    mat["asset_license"] = "CC0-1.0"
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = base_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = 0.1 if metallic else 0.0
    if emission_color and "Emission Color" in shader.inputs:
        shader.inputs["Emission Color"].default_value = emission_color
        shader.inputs["Emission Strength"].default_value = emission_strength
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    if noise_scale:
        texcoord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        noise = nodes.new("ShaderNodeTexNoise")
        ramp = nodes.new("ShaderNodeValToRGB")
        bump = nodes.new("ShaderNodeBump")
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = 0.72
        ramp.color_ramp.elements[0].position = 0.25
        ramp.color_ramp.elements[0].color = (
            max(0.0, base_color[0] * (1.0 - noise_strength)),
            max(0.0, base_color[1] * (1.0 - noise_strength)),
            max(0.0, base_color[2] * (1.0 - noise_strength)),
            1.0,
        )
        ramp.color_ramp.elements[1].position = 0.78
        ramp.color_ramp.elements[1].color = (
            min(1.0, base_color[0] * (1.0 + noise_strength)),
            min(1.0, base_color[1] * (1.0 + noise_strength)),
            min(1.0, base_color[2] * (1.0 + noise_strength)),
            1.0,
        )
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = 0.16
        links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def volume_material(name: str, density: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Density"].default_value = density
    volume.inputs["Color"].default_value = (0.42, 0.52, 0.45, 1.0)
    volume.inputs["Anisotropy"].default_value = 0.55
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return mat


def tag(obj: bpy.types.Object, asset_id: str) -> bpy.types.Object:
    obj["asset_id"] = asset_id
    obj["asset_license"] = "CC0-1.0"
    return obj


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 3) -> None:
    modifier = obj.modifiers.new("Production_Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.06,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        add_bevel(obj, bevel)
    obj.data.materials.append(mat)
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    vertices: int = 24,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.035,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    if bevel:
        add_bevel(obj, bevel, 2)
    obj.data.materials.append(mat)
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_cone_between(
    name: str,
    start: Vector,
    end: Vector,
    radius_start: float,
    radius_end: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    vertices: int = 14,
) -> bpy.types.Object:
    direction = end - start
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    obj.rotation_mode = "XYZ"
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_uv_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    segments: int = 32,
    rings: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_ico(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    subdivisions: int = 2,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def make_leaf_cluster_mesh(
    name: str,
    mat: bpy.types.Material,
    *,
    leaf_count: int = 120,
) -> bpy.types.Mesh:
    """Build one reusable cluster of individually modeled diamond leaves."""
    stable_seed = sum((index + 1) * ord(char) for index, char in enumerate(name))
    local_random = random.Random(stable_seed & 0xFFFF_FFFF)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for _ in range(leaf_count):
        while True:
            center = Vector(
                (
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-0.75, 0.75),
                )
            )
            if center.length_squared <= 1.0:
                break
        angle = local_random.uniform(0.0, math.tau)
        tilt = local_random.uniform(-0.34, 0.34)
        length = local_random.uniform(0.16, 0.28)
        width = length * local_random.uniform(0.38, 0.58)
        forward = Vector((math.cos(angle), math.sin(angle), tilt)).normalized()
        side = Vector((-math.sin(angle), math.cos(angle), local_random.uniform(-0.12, 0.12))).normalized()
        start = len(vertices)
        vertices.extend(
            [
                center - forward * length,
                center + side * width,
                center + forward * length,
                center - side * width,
            ]
        )
        faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    return mesh


def make_bloom_cluster_mesh(
    name: str,
    mat: bpy.types.Material,
    *,
    flower_count: int = 72,
) -> bpy.types.Mesh:
    """Create a reusable hydrangea-like cluster from original petal geometry."""
    stable_seed = sum((index + 1) * ord(char) for index, char in enumerate(name))
    local_random = random.Random((stable_seed ^ 0xA51CE55) & 0xFFFF_FFFF)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for _ in range(flower_count):
        while True:
            center = Vector(
                (
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-0.65, 0.65),
                )
            )
            if center.length_squared <= 1.0:
                break
        petal_radius = local_random.uniform(0.045, 0.085)
        phase = local_random.uniform(0.0, math.tau)
        for petal in range(5):
            angle = phase + math.tau * petal / 5.0
            start = len(vertices)
            tangent = Vector((math.cos(angle), math.sin(angle), local_random.uniform(-0.15, 0.2)))
            side = Vector((-math.sin(angle), math.cos(angle), 0.0))
            vertices.extend(
                [
                    center,
                    center + tangent * petal_radius + side * petal_radius * 0.45,
                    center + tangent * petal_radius * 1.65,
                    center + tangent * petal_radius - side * petal_radius * 0.45,
                ]
            )
            faces.append((start, start + 1, start + 2))
            faces.append((start, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    return mesh


def add_leaf_cluster(
    name: str,
    location: Vector,
    scale: tuple[float, float, float],
    mesh: bpy.types.Mesh,
    target: bpy.types.Collection,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = (
        random.uniform(-0.18, 0.18),
        random.uniform(-0.18, 0.18),
        random.uniform(0.0, math.tau),
    )
    return tag(obj, f"shrine.{name.lower()}")


def add_curve(
    name: str,
    points: list[tuple[float, float, float]],
    bevel_depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    resolution: int = 3,
    cyclic: bool = False,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve_data)
    target.objects.link(obj)
    curve_data.materials.append(mat)
    return tag(obj, f"shrine.{name.lower()}")


def terrain_height(x: float, y: float) -> float:
    slope = 0.105 * (y + 20.0)
    banks = 0.020 * max(abs(x) - 2.3, 0.0) ** 1.55
    undulation = (
        0.34 * math.sin(x * 0.37 + y * 0.11)
        + 0.22 * math.sin(x * 0.91 - y * 0.17)
        + 0.11 * math.sin(x * 1.77 + y * 0.39)
    )
    path_flatten = max(0.0, 1.0 - abs(x) / 3.0)
    return slope + banks + undulation * (1.0 - 0.72 * path_flatten)


def build_terrain(
    target: bpy.types.Collection,
    soil: bpy.types.Material,
    moss: bpy.types.Material,
) -> bpy.types.Object:
    size_x = 42.0
    size_y = 48.0
    nx = 85
    ny = 97
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for iy in range(ny):
        y = -22.0 + size_y * iy / (ny - 1)
        for ix in range(nx):
            x = -size_x * 0.5 + size_x * ix / (nx - 1)
            z = terrain_height(x, y)
            vertices.append((x, y, z))
    for iy in range(ny - 1):
        for ix in range(nx - 1):
            a = iy * nx + ix
            faces.append((a, a + 1, a + 1 + nx, a + nx))
    mesh = bpy.data.meshes.new("JF_Terrain_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    terrain = bpy.data.objects.new("JF_Terrain_Hillside", mesh)
    target.objects.link(terrain)
    terrain.data.materials.append(soil)
    terrain.data.materials.append(moss)
    for polygon in terrain.data.polygons:
        polygon.use_smooth = True
        center = terrain.data.vertices[polygon.vertices[0]].co
        polygon.material_index = 1 if center.z > 1.2 else 0
    add_bevel(terrain, 0.025, 2)
    return tag(terrain, "shrine.terrain.hillside")


def build_stairs(
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    moss: bpy.types.Material,
) -> None:
    for index in range(15):
        y = -15.5 + index * 1.62
        z = terrain_height(0.0, y) + 0.12
        width = 4.45 + random.uniform(-0.32, 0.34)
        depth = 1.55 + random.uniform(-0.10, 0.12)
        height = 0.42 + random.uniform(-0.04, 0.05)
        x = random.uniform(-0.16, 0.16)
        step = add_box(
            f"JF_Step_{index:02d}",
            (x, y, z),
            (width, depth, height),
            stone,
            target,
            rotation=(random.uniform(-0.015, 0.015), random.uniform(-0.02, 0.02), random.uniform(-0.025, 0.025)),
            bevel=0.11,
        )
        step["asset_role"] = "walkable_visual_step"
        for patch in range(3):
            px = x + random.uniform(-width * 0.42, width * 0.42)
            py = y + random.uniform(-depth * 0.38, depth * 0.38)
            add_ico(
                f"JF_StepMoss_{index:02d}_{patch}",
                (px, py, z + height * 0.52),
                (random.uniform(0.24, 0.62), random.uniform(0.18, 0.44), random.uniform(0.025, 0.07)),
                moss,
                target,
                subdivisions=1,
            )

    for side in (-1, 1):
        for index in range(18):
            y = -18.0 + index * 2.05 + random.uniform(-0.2, 0.2)
            x = side * random.uniform(3.4, 8.8)
            z = terrain_height(x, y) + 0.16
            add_box(
                f"JF_RetainingStone_{side}_{index:02d}",
                (x, y, z),
                (random.uniform(1.2, 2.2), random.uniform(0.75, 1.2), random.uniform(0.55, 1.1)),
                stone,
                target,
                rotation=(0.0, random.uniform(-0.08, 0.08), random.uniform(-0.15, 0.15)),
                bevel=0.12,
            )


def roof_mesh(
    name: str,
    center: tuple[float, float, float],
    width: float,
    depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    front_extension: float = 0.0,
) -> bpy.types.Object:
    cx, cy, cz = center
    nx = 33
    ny = 17
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for iy in range(ny):
        v = iy / (ny - 1)
        y_local = (v - 0.5) * depth - front_extension
        for ix in range(nx):
            u = ix / (nx - 1)
            x_local = (u - 0.5) * width
            ridge = 1.85 - 0.38 * abs(y_local)
            upturn_x = 0.055 * max(abs(x_local) - width * 0.34, 0.0) ** 2
            upturn_y = 0.08 * max(abs(y_local) - depth * 0.36, 0.0) ** 2
            z = cz + ridge + upturn_x + upturn_y
            vertices.append((cx + x_local, cy + y_local, z))
    for iy in range(ny - 1):
        for ix in range(nx - 1):
            a = iy * nx + ix
            faces.append((a, a + 1, a + 1 + nx, a + nx))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    mesh.materials.append(mat)
    solidify = obj.modifiers.new("Roof_Thickness", "SOLIDIFY")
    solidify.thickness = 0.24
    solidify.offset = 0.0
    bevel = obj.modifiers.new("Roof_Edge_Bevel", "BEVEL")
    bevel.width = 0.08
    bevel.segments = 3
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return tag(obj, f"shrine.architecture.{name.lower()}")


def build_shrine(
    target: bpy.types.Collection,
    wood: bpy.types.Material,
    wood_red: bpy.types.Material,
    roof: bpy.types.Material,
    stone: bpy.types.Material,
    paper: bpy.types.Material,
    rope: bpy.types.Material,
    gold: bpy.types.Material,
) -> None:
    cx = 2.2
    cy = 15.3
    ground = terrain_height(cx, cy)
    floor_z = ground + 1.1

    add_box("JF_ShrineFoundation", (cx, cy, floor_z - 0.65), (15.2, 8.3, 1.35), stone, target, bevel=0.18)
    add_box("JF_ShrineFloor", (cx, cy - 0.2, floor_z), (14.2, 7.4, 0.42), wood, target, bevel=0.08)

    for row_y in (cy - 3.05, cy + 2.85):
        for col_x in (-5.8, -2.9, 0.0, 2.9, 5.8):
            add_cylinder(
                f"JF_Column_{row_y:.1f}_{col_x:.1f}",
                (cx + col_x, row_y, floor_z + 2.9),
                0.29,
                5.9,
                wood_red,
                target,
                vertices=24,
                bevel=0.025,
            )

    add_box("JF_BackWall", (cx, cy + 3.0, floor_z + 2.55), (12.5, 0.32, 5.0), wood, target)
    add_box("JF_LeftWall", (cx - 6.25, cy, floor_z + 2.55), (0.32, 5.9, 5.0), wood, target)
    add_box("JF_RightWall", (cx + 6.25, cy, floor_z + 2.55), (0.32, 5.9, 5.0), wood, target)

    for x in (-4.7, -2.3, 0.0, 2.3, 4.7):
        add_box(
            f"JF_FrontDoor_{x:.1f}",
            (cx + x, cy - 3.14, floor_z + 2.15),
            (2.0, 0.22, 4.15),
            wood,
            target,
            bevel=0.035,
        )
        for slat in range(-3, 4):
            add_box(
                f"JF_DoorSlat_{x:.1f}_{slat}",
                (cx + x + slat * 0.23, cy - 3.29, floor_z + 2.15),
                (0.07, 0.08, 3.75),
                wood_red,
                target,
                bevel=0.01,
            )

    for y_offset in (-3.36, 3.2):
        add_box("JF_TopBeam", (cx, cy + y_offset, floor_z + 5.3), (14.2, 0.42, 0.45), wood_red, target, bevel=0.06)
        add_box("JF_MidBeam", (cx, cy + y_offset, floor_z + 3.9), (13.5, 0.34, 0.34), wood_red, target, bevel=0.05)

    roof_mesh("JF_MainRoof", (cx, cy, floor_z + 5.15), 18.2, 11.2, roof, target)
    roof_mesh("JF_PorchRoof", (cx, cy - 4.2, floor_z + 4.15), 12.8, 5.2, roof, target, front_extension=0.5)

    # Decorative roof ribs follow the pitch and make the silhouette readable.
    for x in [cx - 8.0 + i * 0.8 for i in range(21)]:
        points = []
        for step in range(13):
            y_local = -5.1 + step * 0.85
            ridge = 1.85 - 0.38 * abs(y_local)
            upturn_x = 0.055 * max(abs(x - cx) - 18.2 * 0.34, 0.0) ** 2
            upturn_y = 0.08 * max(abs(y_local) - 11.2 * 0.36, 0.0) ** 2
            points.append((x, cy + y_local, floor_z + 5.15 + ridge + upturn_x + upturn_y + 0.12))
        add_curve(f"JF_RoofRib_{x:.2f}", points, 0.055, roof, target, resolution=1)

    add_curve(
        "JF_RoofRidge",
        [
            (cx - 8.3, cy, floor_z + 7.15),
            (cx, cy, floor_z + 7.35),
            (cx + 8.3, cy, floor_z + 7.15),
        ],
        0.22,
        roof,
        target,
    )
    for side in (-1, 1):
        add_curve(
            f"JF_RoofFinial_{side}",
            [
                (cx + side * 7.8, cy, floor_z + 7.0),
                (cx + side * 8.5, cy, floor_z + 7.6),
                (cx + side * 8.1, cy, floor_z + 8.35),
            ],
            0.15,
            roof,
            target,
        )

    # Front stairs and veranda.
    for index in range(5):
        add_box(
            f"JF_PorchStep_{index}",
            (cx, cy - 5.0 - index * 0.55, floor_z - 0.15 - index * 0.22),
            (5.6 + index * 0.4, 0.72, 0.32),
            stone,
            target,
            bevel=0.08,
        )
    for side in (-1, 1):
        for x_offset in range(6):
            x = cx + side * (2.8 + x_offset * 0.58)
            add_cylinder(
                f"JF_RailingPost_{side}_{x_offset}",
                (x, cy - 3.55, floor_z + 0.75),
                0.095,
                1.5,
                wood_red,
                target,
                vertices=12,
            )
        add_box(
            f"JF_RailingTop_{side}",
            (cx + side * 4.2, cy - 3.55, floor_z + 1.45),
            (3.3, 0.16, 0.18),
            wood_red,
            target,
            bevel=0.035,
        )

    # Shimenawa rope and folded shide paper.
    add_curve(
        "JF_Shimenawa",
        [
            (cx - 3.3, cy - 3.55, floor_z + 3.55),
            (cx, cy - 3.72, floor_z + 3.2),
            (cx + 3.3, cy - 3.55, floor_z + 3.55),
        ],
        0.115,
        rope,
        target,
    )
    for index, x in enumerate((-2.4, -1.2, 0.0, 1.2, 2.4)):
        z = floor_z + 3.25 - 0.12 * (1.0 - abs(x) / 2.4)
        add_box(
            f"JF_Shide_{index}",
            (cx + x, cy - 3.82, z - 0.35),
            (0.36, 0.035, 0.82),
            paper,
            target,
            rotation=(0.0, 0.0, 0.18 if index % 2 else -0.18),
            bevel=0.01,
        )

    add_cylinder("JF_OfferingBell", (cx, cy - 3.95, floor_z + 2.35), 0.28, 0.55, gold, target, vertices=32)
    add_curve(
        "JF_BellRope",
        [(cx, cy - 4.0, floor_z + 3.5), (cx + 0.08, cy - 4.15, floor_z + 1.15)],
        0.055,
        rope,
        target,
    )


def build_lantern(
    name: str,
    x: float,
    y: float,
    scale: float,
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    dark: bpy.types.Material,
    glow: bpy.types.Material,
    moss: bpy.types.Material,
) -> None:
    z = terrain_height(x, y)
    add_cylinder(f"{name}_Base", (x, y, z + 0.22 * scale), 0.76 * scale, 0.44 * scale, stone, target, vertices=8)
    add_cylinder(f"{name}_Post", (x, y, z + 1.45 * scale), 0.30 * scale, 2.2 * scale, stone, target, vertices=8)
    add_box(f"{name}_Chamber", (x, y, z + 2.75 * scale), (1.15 * scale, 1.15 * scale, 1.25 * scale), stone, target, bevel=0.08 * scale)
    for side in (-1, 1):
        add_box(
            f"{name}_OpeningX_{side}",
            (x + side * 0.59 * scale, y, z + 2.76 * scale),
            (0.035 * scale, 0.60 * scale, 0.68 * scale),
            dark,
            target,
            bevel=0.01,
        )
        add_box(
            f"{name}_OpeningY_{side}",
            (x, y + side * 0.59 * scale, z + 2.76 * scale),
            (0.60 * scale, 0.035 * scale, 0.68 * scale),
            dark,
            target,
            bevel=0.01,
        )
    add_uv_sphere(f"{name}_Glow", (x, y, z + 2.75 * scale), (0.34 * scale, 0.34 * scale, 0.40 * scale), glow, target, segments=20, rings=12)
    add_cylinder(f"{name}_Roof", (x, y, z + 3.48 * scale), 1.04 * scale, 0.30 * scale, stone, target, vertices=8)
    add_cylinder(f"{name}_Cap", (x, y, z + 3.84 * scale), 0.34 * scale, 0.56 * scale, stone, target, vertices=8)
    for patch in range(4):
        add_ico(
            f"{name}_Moss_{patch}",
            (
                x + random.uniform(-0.45, 0.45) * scale,
                y + random.uniform(-0.45, 0.45) * scale,
                z + random.uniform(0.45, 3.55) * scale,
            ),
            (0.28 * scale, 0.20 * scale, 0.08 * scale),
            moss,
            target,
            subdivisions=1,
        )


def build_guardian(
    name: str,
    x: float,
    y: float,
    scale: float,
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    dark: bpy.types.Material,
    moss: bpy.types.Material,
    *,
    mirrored: bool,
) -> None:
    sign = -1 if mirrored else 1
    ground = terrain_height(x, y)
    add_box(f"{name}_PedestalLower", (x, y, ground + 0.35 * scale), (2.2 * scale, 2.2 * scale, 0.7 * scale), stone, target, bevel=0.15 * scale)
    add_box(f"{name}_PedestalUpper", (x, y, ground + 0.85 * scale), (1.8 * scale, 1.8 * scale, 0.35 * scale), stone, target, bevel=0.12 * scale)
    base = ground + 1.0 * scale

    add_uv_sphere(f"{name}_Body", (x, y + 0.18 * scale, base + 1.52 * scale), (0.92 * scale, 1.42 * scale, 0.88 * scale), stone, target)
    add_uv_sphere(f"{name}_Chest", (x, y - 0.84 * scale, base + 1.82 * scale), (0.76 * scale, 0.74 * scale, 1.02 * scale), stone, target)
    add_uv_sphere(f"{name}_Head", (x, y - 1.03 * scale, base + 3.0 * scale), (0.84 * scale, 0.78 * scale, 0.78 * scale), stone, target)
    add_uv_sphere(f"{name}_Muzzle", (x, y - 1.70 * scale, base + 2.83 * scale), (0.58 * scale, 0.50 * scale, 0.38 * scale), stone, target)
    add_uv_sphere(f"{name}_MouthShadow", (x, y - 1.86 * scale, base + 2.55 * scale), (0.46 * scale, 0.29 * scale, 0.16 * scale), dark, target, segments=24, rings=14)
    add_uv_sphere(f"{name}_Jaw", (x, y - 1.67 * scale, base + 2.40 * scale), (0.53 * scale, 0.42 * scale, 0.22 * scale), stone, target)
    add_uv_sphere(f"{name}_Nose", (x, y - 2.08 * scale, base + 2.92 * scale), (0.22 * scale, 0.16 * scale, 0.15 * scale), dark, target, segments=20, rings=12)

    for side in (-1, 1):
        add_uv_sphere(
            f"{name}_Ear_{side}",
            (x + side * 0.60 * scale, y - 1.02 * scale, base + 3.55 * scale),
            (0.28 * scale, 0.22 * scale, 0.45 * scale),
            stone,
            target,
            segments=24,
            rings=16,
        )
        add_uv_sphere(
            f"{name}_Eye_{side}",
            (x + side * 0.35 * scale, y - 1.66 * scale, base + 3.15 * scale),
            (0.14 * scale, 0.10 * scale, 0.13 * scale),
            dark,
            target,
            segments=20,
            rings=12,
        )

    for side in (-1, 1):
        for back in (0, 1):
            lx = x + side * 0.55 * scale
            ly = y + (0.45 if back else -0.65) * scale
            add_cylinder(
                f"{name}_Leg_{side}_{back}",
                (lx, ly, base + 0.88 * scale),
                0.27 * scale,
                1.45 * scale,
                stone,
                target,
                vertices=20,
                bevel=0.04,
            )
            add_uv_sphere(
                f"{name}_Paw_{side}_{back}",
                (lx, ly - 0.18 * scale, base + 0.20 * scale),
                (0.38 * scale, 0.52 * scale, 0.22 * scale),
                stone,
                target,
                segments=24,
                rings=14,
            )
            for toe in (-1, 0, 1):
                add_uv_sphere(
                    f"{name}_Toe_{side}_{back}_{toe}",
                    (lx + toe * 0.15 * scale, ly - 0.56 * scale, base + 0.20 * scale),
                    (0.10 * scale, 0.18 * scale, 0.09 * scale),
                    dark,
                    target,
                    segments=16,
                    rings=10,
                )

    # Mane curls and eyebrows give the original sculpture a traditional silhouette.
    for ring in range(2):
        count = 11 + ring * 3
        for index in range(count):
            angle = math.tau * index / count
            radius = (0.75 + 0.22 * ring) * scale
            add_uv_sphere(
                f"{name}_Mane_{ring}_{index:02d}",
                (
                    x + math.cos(angle) * radius,
                    y - 0.83 * scale + math.sin(angle) * 0.20 * scale,
                    base + 3.00 * scale + math.sin(angle) * radius,
                ),
                (0.20 * scale, 0.18 * scale, 0.20 * scale),
                stone,
                target,
                segments=16,
                rings=10,
            )
    for side in (-1, 1):
        add_curve(
            f"{name}_Brow_{side}",
            [
                (x + side * 0.10 * scale, y - 1.72 * scale, base + 3.35 * scale),
                (x + side * 0.38 * scale, y - 1.79 * scale, base + 3.48 * scale),
                (x + side * 0.57 * scale, y - 1.65 * scale, base + 3.37 * scale),
            ],
            0.08 * scale,
            stone,
            target,
        )
    add_curve(
        f"{name}_Tail",
        [
            (x + sign * 0.65 * scale, y + 0.95 * scale, base + 1.2 * scale),
            (x + sign * 1.28 * scale, y + 1.05 * scale, base + 2.0 * scale),
            (x + sign * 1.05 * scale, y + 0.65 * scale, base + 2.85 * scale),
            (x + sign * 0.72 * scale, y + 0.60 * scale, base + 2.5 * scale),
        ],
        0.24 * scale,
        stone,
        target,
    )
    for patch in range(8):
        add_ico(
            f"{name}_Moss_{patch}",
            (
                x + random.uniform(-0.75, 0.75) * scale,
                y + random.uniform(-1.1, 0.9) * scale,
                base + random.uniform(0.45, 3.4) * scale,
            ),
            (random.uniform(0.18, 0.45) * scale, random.uniform(0.16, 0.38) * scale, random.uniform(0.035, 0.09) * scale),
            moss,
            target,
            subdivisions=1,
        )


def build_tree(
    index: int,
    x: float,
    y: float,
    height: float,
    target: bpy.types.Collection,
    bark: bpy.types.Material,
    foliage_meshes: list[bpy.types.Mesh],
) -> None:
    z = terrain_height(x, y)
    lean = Vector((random.uniform(-0.14, 0.14), random.uniform(-0.08, 0.10), 1.0)).normalized()
    points = [Vector((x, y, z))]
    for level in range(1, 7):
        fraction = level / 6.0
        sway = Vector(
            (
                math.sin(index * 1.7 + fraction * 3.3) * 0.45 * fraction,
                math.cos(index * 0.9 + fraction * 2.1) * 0.30 * fraction,
                0.0,
            )
        )
        points.append(Vector((x, y, z)) + lean * (height * fraction) + sway)
    for level in range(6):
        taper = 1.0 - level / 7.2
        add_cone_between(
            f"JF_Tree_{index:02d}_Trunk_{level}",
            points[level],
            points[level + 1],
            0.42 * taper * (height / 12.0),
            0.34 * taper * (height / 12.0),
            bark,
            target,
            vertices=16,
        )

    for branch_index in range(9):
        source_level = random.randint(2, 5)
        origin = points[source_level]
        angle = random.uniform(0, math.tau)
        length = height * random.uniform(0.17, 0.30)
        end = origin + Vector(
            (
                math.cos(angle) * length,
                math.sin(angle) * length,
                length * random.uniform(0.18, 0.50),
            )
        )
        add_cone_between(
            f"JF_Tree_{index:02d}_Branch_{branch_index}",
            origin,
            end,
            0.17 * (height / 12.0),
            0.055 * (height / 12.0),
            bark,
            target,
            vertices=12,
        )
        for cluster_index in range(3):
            position = end + Vector(
                (
                    random.uniform(-1.15, 1.15),
                    random.uniform(-1.15, 1.15),
                    random.uniform(-0.35, 0.95),
                )
            )
            add_leaf_cluster(
                f"JF_Tree_{index:02d}_Foliage_{branch_index}_{cluster_index}",
                position,
                (
                    random.uniform(1.05, 1.55),
                    random.uniform(0.90, 1.40),
                    random.uniform(0.85, 1.30),
                ),
                random.choice(foliage_meshes),
                target,
            )


def build_grass_and_flowers(
    target: bpy.types.Collection,
    grass: bpy.types.Material,
    moss: bpy.types.Material,
    pink: bpy.types.Material,
    purple: bpy.types.Material,
    white: bpy.types.Material,
) -> None:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for index in range(2400):
        x = random.uniform(-20.0, 20.0)
        y = random.uniform(-20.0, 23.0)
        if abs(x) < 2.8 and -17.5 < y < 12.0:
            continue
        if -6.5 < x - 2.2 < 6.5 and 11.0 < y < 20.0:
            continue
        z = terrain_height(x, y) + 0.03
        height = random.uniform(0.18, 0.58)
        width = random.uniform(0.025, 0.075)
        angle = random.uniform(0, math.tau)
        side = Vector((math.cos(angle) * width, math.sin(angle) * width, 0.0))
        for cross_angle in (angle, angle + math.pi * 0.5):
            cross_side = Vector((math.cos(cross_angle) * width, math.sin(cross_angle) * width, 0.0))
            start = len(vertices)
            vertices.extend(
                [
                    (x - cross_side.x, y - cross_side.y, z),
                    (x + cross_side.x, y + cross_side.y, z),
                    (
                        x + math.cos(cross_angle + 1.2) * height * 0.13,
                        y + math.sin(cross_angle + 1.2) * height * 0.13,
                        z + height,
                    ),
                ]
            )
            faces.append((start, start + 1, start + 2))
    mesh = bpy.data.meshes.new("JF_Grass_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("JF_Grass_Meadow", mesh)
    target.objects.link(obj)
    mesh.materials.append(grass)
    tag(obj, "shrine.vegetation.grass")

    # Moss banks as low overlapping forms.
    for index in range(110):
        x = random.choice((-1, 1)) * random.uniform(2.8, 12.0)
        y = random.uniform(-17.0, 18.0)
        z = terrain_height(x, y) + 0.10
        add_ico(
            f"JF_MossBank_{index:03d}",
            (x, y, z),
            (random.uniform(0.35, 1.0), random.uniform(0.3, 0.9), random.uniform(0.10, 0.28)),
            moss,
            target,
            subdivisions=1,
        )

    flower_vertices: list[tuple[float, float, float]] = []
    flower_faces: list[tuple[int, int, int]] = []
    flower_material_indices: list[int] = []
    for index in range(260):
        side = random.choice((-1, 1))
        x = side * random.uniform(3.0, 12.5)
        y = random.uniform(-10.0, 14.0)
        z = terrain_height(x, y) + random.uniform(0.24, 0.48)
        radius = random.uniform(0.11, 0.20)
        material_index = random.randrange(3)
        for petal in range(5):
            angle = math.tau * petal / 5.0
            start = len(flower_vertices)
            flower_vertices.extend(
                [
                    (x, y, z),
                    (x + math.cos(angle - 0.48) * radius, y + math.sin(angle - 0.48) * radius, z + 0.02),
                    (x + math.cos(angle + 0.48) * radius, y + math.sin(angle + 0.48) * radius, z + 0.02),
                ]
            )
            flower_faces.append((start, start + 1, start + 2))
            flower_material_indices.append(material_index)
    flower_mesh = bpy.data.meshes.new("JF_Flower_Mesh")
    flower_mesh.from_pydata(flower_vertices, [], flower_faces)
    flower_mesh.update()
    flowers = bpy.data.objects.new("JF_Flower_Banks", flower_mesh)
    target.objects.link(flowers)
    for mat in (pink, purple, white):
        flower_mesh.materials.append(mat)
    for polygon, material_index in zip(flower_mesh.polygons, flower_material_indices):
        polygon.material_index = material_index
    tag(flowers, "shrine.vegetation.flowers")


def build_hydrangea_banks(
    target: bpy.types.Collection,
    moss: bpy.types.Material,
    bloom_meshes: list[bpy.types.Mesh],
) -> None:
    positions = [
        (-8.8, -2.5, 1.55),
        (-7.2, -1.4, 1.35),
        (-9.5, 1.0, 1.60),
        (-6.5, 4.2, 1.35),
        (-8.2, 6.2, 1.55),
        (-5.8, 10.1, 1.30),
        (6.0, 0.5, 1.35),
        (8.5, 2.7, 1.55),
        (6.8, 5.8, 1.30),
        (10.0, 7.0, 1.65),
        (7.4, 10.5, 1.40),
        (10.3, 12.0, 1.50),
    ]
    for index, (x, y, radius) in enumerate(positions):
        z = terrain_height(x, y)
        add_ico(
            f"JF_HydrangeaFoliage_{index:02d}",
            (x, y, z + radius * 0.50),
            (radius * 1.15, radius, radius * 0.72),
            moss,
            target,
            subdivisions=3,
        )
        for cluster in range(3):
            angle = math.tau * cluster / 3.0 + random.uniform(-0.35, 0.35)
            offset = Vector(
                (
                    math.cos(angle) * radius * 0.48,
                    math.sin(angle) * radius * 0.42,
                    radius * random.uniform(0.55, 0.82),
                )
            )
            add_leaf_cluster(
                f"JF_HydrangeaBloom_{index:02d}_{cluster}",
                Vector((x, y, z)) + offset,
                (radius * 0.72, radius * 0.62, radius * 0.58),
                bloom_meshes[(index + cluster) % len(bloom_meshes)],
                target,
            )


def build_fog_cards(
    target: bpy.types.Collection,
    fog_mat: bpy.types.Material,
) -> None:
    # Localized volume boxes produce readable light shafts without filling the
    # entire scene with expensive high-density fog.
    add_box("JF_FogVolume_Left", (-10.0, -1.0, 9.5), (11.0, 24.0, 19.0), fog_mat, target, bevel=0.0)
    add_box("JF_FogVolume_Back", (4.0, 15.0, 11.0), (22.0, 12.0, 18.0), fog_mat, target, bevel=0.0)


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_camera_and_lighting(
    scene: bpy.types.Scene,
    target: bpy.types.Collection,
    glow_mat: bpy.types.Material,
) -> None:
    camera_data = bpy.data.cameras.new("JF_Hero_Camera")
    camera = bpy.data.objects.new("JF_Hero_Camera", camera_data)
    target.objects.link(camera)
    camera.location = (-0.6, -28.5, 6.9)
    camera_data.lens = 34.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = True
    camera_data.dof.focus_distance = 31.0
    camera_data.dof.aperture_fstop = 5.6
    look_at(camera, (1.8, 8.5, 6.2))
    scene.camera = camera
    tag(camera, "shrine.camera.hero")

    sun_data = bpy.data.lights.new("JF_Sun", "SUN")
    sun_data.energy = 4.5
    sun_data.angle = math.radians(7.0)
    sun_data.color = (1.0, 0.78, 0.52)
    sun = bpy.data.objects.new("JF_Sun", sun_data)
    target.objects.link(sun)
    sun.rotation_euler = (math.radians(28), math.radians(-34), math.radians(-38))
    tag(sun, "shrine.light.sun")

    area_data = bpy.data.lights.new("JF_KeyArea", "AREA")
    area_data.energy = 3600.0
    area_data.shape = "DISK"
    area_data.size = 9.0
    area_data.color = (1.0, 0.70, 0.42)
    area = bpy.data.objects.new("JF_KeyArea", area_data)
    target.objects.link(area)
    area.location = (-12.0, -7.0, 20.0)
    look_at(area, (0.0, 5.0, 3.0))
    tag(area, "shrine.light.key")

    fill_data = bpy.data.lights.new("JF_FillArea", "AREA")
    fill_data.energy = 1800.0
    fill_data.shape = "RECTANGLE"
    fill_data.size = 12.0
    fill_data.color = (0.33, 0.48, 0.72)
    fill = bpy.data.objects.new("JF_FillArea", fill_data)
    target.objects.link(fill)
    fill.location = (13.0, 4.0, 12.0)
    look_at(fill, (1.0, 10.0, 5.0))
    tag(fill, "shrine.light.fill")

    front_data = bpy.data.lights.new("JF_FrontBounce", "AREA")
    front_data.energy = 2200.0
    front_data.shape = "RECTANGLE"
    front_data.size = 10.0
    front_data.color = (0.58, 0.70, 0.92)
    front = bpy.data.objects.new("JF_FrontBounce", front_data)
    target.objects.link(front)
    front.location = (0.0, -17.0, 11.0)
    look_at(front, (1.5, 10.0, 5.0))
    tag(front, "shrine.light.front_bounce")

    for index, location in enumerate(((-6.5, 1.0, 5.0), (8.0, 7.0, 6.5), (2.0, 11.0, 8.0))):
        spot_data = bpy.data.lights.new(f"JF_VolumeSpot_{index}", "SPOT")
        spot_data.energy = 950.0 if index == 0 else 550.0
        spot_data.color = (1.0, 0.68, 0.38)
        spot_data.spot_size = math.radians(24.0)
        spot_data.spot_blend = 0.55
        spot = bpy.data.objects.new(f"JF_VolumeSpot_{index}", spot_data)
        target.objects.link(spot)
        spot.location = location
        look_at(spot, (0.0, 2.0 + index * 4.0, 1.0))
        tag(spot, f"shrine.light.spot.{index}")

    world = bpy.data.worlds.new("JF_Forest_World") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Color"].default_value = (0.012, 0.022, 0.017, 1.0)
    background.inputs["Strength"].default_value = 0.55
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(background.outputs["Background"], output.inputs["Surface"])


def configure_render(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.45

    # Blender 5.1 moved compositor ownership to Scene.compositing_node_group
    # and removed the legacy Scene.node_tree API. Keep this source compatible
    # with the official 5.1 MCP build by rendering directly; restrained bloom
    # is added in the Three.js runtime rather than baked into the source image.
    scene.use_nodes = False
    scene.compositing_node_group = None


def main() -> dict[str, object]:
    scene = clean_scene()

    root = collection("JF_Original_CC0_Shrine")
    terrain_col = collection("01_Terrain", root)
    architecture_col = collection("02_Shrine_Architecture", root)
    sculpture_col = collection("03_Original_Sculptures", root)
    props_col = collection("04_Stone_Lanterns", root)
    vegetation_col = collection("05_Vegetation", root)
    atmosphere_col = collection("06_Atmosphere", root)
    cameras_col = collection("07_Camera_Lighting", root)

    soil = material("JF_Soil", (0.055, 0.043, 0.028, 1.0), 0.96, noise_scale=4.2, noise_strength=0.50, bump_strength=0.42)
    stone = material("JF_WeatheredStone", (0.17, 0.19, 0.16, 1.0), 0.91, noise_scale=5.5, noise_strength=0.42, bump_strength=0.55)
    guardian_stone = material("JF_GuardianPatina", (0.13, 0.19, 0.14, 1.0), 0.86, noise_scale=7.5, noise_strength=0.40, bump_strength=0.48)
    moss = material("JF_Moss", (0.055, 0.135, 0.030, 1.0), 0.96, noise_scale=9.0, noise_strength=0.46, bump_strength=0.36)
    bark = material("JF_Bark", (0.075, 0.045, 0.025, 1.0), 0.94, noise_scale=5.8, noise_strength=0.58, bump_strength=0.64)
    wood = material("JF_AgedWood", (0.075, 0.036, 0.020, 1.0), 0.78, noise_scale=6.2, noise_strength=0.52, bump_strength=0.30)
    wood_red = material("JF_VermilionWood", (0.22, 0.035, 0.017, 1.0), 0.70, noise_scale=7.0, noise_strength=0.28, bump_strength=0.18)
    roof = material("JF_BlueBlackRoofTile", (0.018, 0.028, 0.042, 1.0), 0.34, metallic=0.16, noise_scale=11.0, noise_strength=0.25, bump_strength=0.25)
    dark = material("JF_DeepShadow", (0.008, 0.009, 0.008, 1.0), 0.68)
    rope = material("JF_StrawRope", (0.32, 0.19, 0.065, 1.0), 0.91, noise_scale=15.0, noise_strength=0.42, bump_strength=0.40)
    paper = material("JF_WhitePaper", (0.72, 0.70, 0.61, 1.0), 0.82, noise_scale=18.0, noise_strength=0.08, bump_strength=0.07)
    gold = material("JF_BronzeBell", (0.24, 0.11, 0.025, 1.0), 0.32, metallic=0.72, noise_scale=9.0, noise_strength=0.18, bump_strength=0.12)
    grass = material("JF_Grass", (0.035, 0.12, 0.020, 1.0), 0.91, noise_scale=6.0, noise_strength=0.38, bump_strength=0.12)
    foliage_1 = material("JF_FoliageDeep", (0.014, 0.065, 0.022, 1.0), 0.84, noise_scale=5.5, noise_strength=0.38, bump_strength=0.18)
    foliage_2 = material("JF_FoliageMid", (0.035, 0.145, 0.050, 1.0), 0.82, noise_scale=6.5, noise_strength=0.34, bump_strength=0.16)
    foliage_3 = material("JF_FoliageSunlit", (0.105, 0.235, 0.065, 1.0), 0.80, noise_scale=7.0, noise_strength=0.28, bump_strength=0.15)
    pink = material("JF_FlowerPink", (0.70, 0.14, 0.36, 1.0), 0.72)
    purple = material("JF_FlowerPurple", (0.20, 0.08, 0.68, 1.0), 0.70)
    white = material("JF_FlowerWhite", (0.88, 0.80, 0.74, 1.0), 0.76)
    glow = material(
        "JF_LanternGlow",
        (0.38, 0.16, 0.025, 1.0),
        0.35,
        emission_color=(1.0, 0.27, 0.035, 1.0),
        emission_strength=5.0,
    )
    fog = volume_material("JF_LocalFog", 0.013)
    leaf_meshes = [
        make_leaf_cluster_mesh("JF_LeafCluster_Deep", foliage_1),
        make_leaf_cluster_mesh("JF_LeafCluster_Mid", foliage_2),
        make_leaf_cluster_mesh("JF_LeafCluster_Sunlit", foliage_3),
    ]
    bloom_meshes = [
        make_bloom_cluster_mesh("JF_BloomCluster_Pink", pink),
        make_bloom_cluster_mesh("JF_BloomCluster_Purple", purple),
        make_bloom_cluster_mesh("JF_BloomCluster_White", white),
    ]

    build_terrain(terrain_col, soil, moss)
    build_stairs(terrain_col, stone, moss)
    build_shrine(architecture_col, wood, wood_red, roof, stone, paper, rope, gold)

    build_guardian("JF_Guardian_Left", -5.4, 8.2, 1.05, sculpture_col, guardian_stone, dark, moss, mirrored=False)
    build_guardian("JF_Guardian_Right", 8.0, 7.3, 1.18, sculpture_col, guardian_stone, dark, moss, mirrored=True)

    build_lantern("JF_Lantern_Foreground", -6.2, 0.4, 1.05, props_col, stone, dark, glow, moss)
    build_lantern("JF_Lantern_Right", 7.2, 11.0, 0.82, props_col, stone, dark, glow, moss)
    build_lantern("JF_Lantern_Back", -4.2, 12.3, 0.72, props_col, stone, dark, glow, moss)

    tree_positions = [
        (-16.5, -8.0, 15.0),
        (-13.0, 0.0, 13.0),
        (-11.0, 11.0, 12.0),
        (-8.0, 20.0, 14.0),
        (14.5, -4.0, 14.0),
        (16.8, 4.0, 13.5),
        (14.0, 13.0, 15.5),
        (10.5, 22.0, 13.0),
        (-3.5, 23.0, 14.5),
        (4.5, 24.0, 15.0),
        (-18.0, 17.0, 16.0),
        (18.0, 20.0, 15.0),
    ]
    for index, (x, y, height) in enumerate(tree_positions):
        build_tree(index, x, y, height, vegetation_col, bark, leaf_meshes)

    build_grass_and_flowers(vegetation_col, grass, moss, pink, purple, white)
    build_hydrangea_banks(vegetation_col, moss, bloom_meshes)
    build_fog_cards(atmosphere_col, fog)
    setup_camera_and_lighting(scene, cameras_col, glow)
    configure_render(scene)

    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=False)

    scene["object_count_at_save"] = len(scene.objects)
    scene["material_count_at_save"] = len(bpy.data.materials)
    scene["collection_count_at_save"] = len(bpy.data.collections)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=False)

    return {
        "blend": str(BLEND_PATH),
        "preview": str(PREVIEW_PATH),
        "objects": len(scene.objects),
        "materials": len(bpy.data.materials),
        "collections": len(bpy.data.collections),
        "meshes": len(bpy.data.meshes),
        "curves": len(bpy.data.curves),
        "license": scene["asset_license"],
        "asset_id": scene["asset_id"],
    }


result = main()
