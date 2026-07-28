"""Build Shenron City's photoreal layered meadow authoring scene.

The scene follows the three realism layers demonstrated in the reference:

1. Multiple compatible species and surface sizes.
2. Deterministic clustered distribution, scale masks, and path/rock exclusion.
3. Shared, subtle wind motion instead of noisy independent animation.

Run after ``fetch_cc0_meadow_assets.py``:

    blender --background --factory-startup --python create_aaa_meadow.py

The .blend stays in the ignored authoring tree. The rendered preview and the
source/receipt scripts are the reviewable, reproducible Git artifacts.
"""

from __future__ import annotations

import math
import random
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


SEED = 24072026
random.seed(SEED)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
RAW_ROOT = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Raw"
    / "Verified"
    / "PolyHaven"
)
BLEND_PATH = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Working"
    / "Shenron_AAA_Meadow.blend"
)
PREVIEW_PATH = (
    REPO_ROOT
    / "docs"
    / "Assets"
    / "Previews"
    / "aaa-meadow-blender.png"
)

ASSET_FILES = {
    "forest_floor": RAW_ROOT
    / "forest_ground_04"
    / "forest_ground_04_1k.blend",
    "path_surface": RAW_ROOT
    / "brown_mud_leaves_01"
    / "brown_mud_leaves_01_1k.blend",
    "grass_c": RAW_ROOT
    / "grass_bermuda_01"
    / "grass_bermuda_01_1k.blend",
    "grass_a": RAW_ROOT
    / "grass_medium_01"
    / "grass_medium_01_1k.blend",
    "grass_b": RAW_ROOT
    / "grass_medium_02"
    / "grass_medium_02_1k.blend",
    "fern": RAW_ROOT / "fern_02" / "fern_02_1k.blend",
    "nettle": RAW_ROOT / "nettle_plant" / "nettle_plant_1k.blend",
    "weed": RAW_ROOT / "weed_plant_02" / "weed_plant_02_1k.blend",
    "moss": RAW_ROOT / "moss_01" / "moss_01_1k.blend",
    "branches": RAW_ROOT
    / "dry_branches_medium_01"
    / "dry_branches_medium_01_1k.blend",
    "rocks": RAW_ROOT
    / "rock_moss_set_01"
    / "rock_moss_set_01_1k.blend",
    "pine_small": RAW_ROOT
    / "pine_sapling_small"
    / "pine_sapling_small_1k.blend",
    "pine_medium": RAW_ROOT
    / "pine_sapling_medium"
    / "pine_sapling_medium_1k.blend",
    "pine_tree": RAW_ROOT
    / "pine_tree_01"
    / "pine_tree_01_1k.blend",
    "sky_hdri": RAW_ROOT
    / "autumn_field_puresky"
    / "autumn_field_puresky_2k.hdr",
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def collection(name: str, parent: bpy.types.Collection | None = None):
    result = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(result)
    return result


def link_object(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)


def terrain_height(x: float, y: float) -> float:
    broad = (
        0.20 * math.sin(x * 0.16)
        + 0.15 * math.cos(y * 0.11)
        + 0.10 * math.sin((x + y) * 0.23)
    )
    micro = 0.035 * math.sin(x * 1.9 + math.cos(y * 0.7))
    ridge = 0.0
    if y > 6.0:
        ridge_factor = min(1.0, (y - 6.0) / 18.0)
        ridge = 0.95 * ridge_factor * ridge_factor * (3.0 - 2.0 * ridge_factor)
    return broad + micro + ridge


def path_center(y: float) -> float:
    return 1.8 * math.sin(y * 0.105) + 0.35 * math.sin(y * 0.31)


def distance_from_path(x: float, y: float) -> float:
    return abs(x - path_center(y))


def cluster_mask(x: float, y: float, phase: float = 0.0) -> float:
    """Cheap deterministic low-frequency mask in the 0..1 range."""
    wave = (
        math.sin(x * 0.37 + phase)
        + math.cos(y * 0.29 - phase * 0.6)
        + math.sin((x + y) * 0.17 + phase * 1.7)
        + math.cos((x - y) * 0.11 - phase)
    )
    return max(0.0, min(1.0, 0.5 + wave * 0.115))


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def principled_material(
    name: str,
    base_color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = base_color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return material


def terrain_material() -> bpy.types.Material:
    material = bpy.data.materials.new("M_Ground_ForestFloor")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.93
    shader.inputs["Specular IOR Level"].default_value = 0.28

    macro = nodes.new("ShaderNodeTexNoise")
    macro.inputs["Scale"].default_value = 0.42
    macro.inputs["Detail"].default_value = 7.0
    macro.inputs["Roughness"].default_value = 0.72
    macro.inputs["Distortion"].default_value = 0.12

    fine = nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 11.0
    fine.inputs["Detail"].default_value = 5.0
    fine.inputs["Roughness"].default_value = 0.78

    ramp = nodes.new("ShaderNodeValToRGB")
    colors = ramp.color_ramp
    colors.elements.remove(colors.elements[1])
    colors.elements[0].position = 0.16
    colors.elements[0].color = (0.025, 0.017, 0.008, 1.0)
    leaf_litter = colors.elements.new(0.38)
    leaf_litter.color = (0.11, 0.055, 0.018, 1.0)
    moss = colors.elements.new(0.58)
    moss.color = (0.055, 0.115, 0.018, 1.0)
    green = colors.elements.new(0.78)
    green.color = (0.12, 0.21, 0.035, 1.0)
    highlight = colors.elements.new(0.94)
    highlight.color = (0.24, 0.29, 0.065, 1.0)

    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 0.72

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.28
    bump.inputs["Distance"].default_value = 0.12

    links.new(macro.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], multiply.inputs[1])
    links.new(fine.outputs["Fac"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
    links.new(fine.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def path_material() -> bpy.types.Material:
    material = bpy.data.materials.new("M_Path_DampEarth")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    principled.inputs["Roughness"].default_value = 0.84

    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 8.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.016, 0.011, 0.007, 1.0)
    ramp.color_ramp.elements[1].color = (0.075, 0.044, 0.018, 1.0)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.34
    bump.inputs["Distance"].default_value = 0.08
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    return material


def rock_material() -> bpy.types.Material:
    material = bpy.data.materials.new("M_Rock_Moss_Procedural")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    principled.inputs["Roughness"].default_value = 0.88

    coordinates = nodes.new("ShaderNodeTexCoord")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "3D"
    noise.inputs["Scale"].default_value = 2.8
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.76
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.26
    ramp.color_ramp.elements[0].color = (0.018, 0.021, 0.014, 1.0)
    ramp.color_ramp.elements[1].position = 0.80
    ramp.color_ramp.elements[1].color = (0.19, 0.16, 0.11, 1.0)
    moss = ramp.color_ramp.elements.new(0.56)
    moss.color = (0.025, 0.052, 0.014, 1.0)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.42
    bump.inputs["Distance"].default_value = 0.16
    links.new(coordinates.outputs["Generated"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], principled.inputs["Normal"])
    return material


def create_terrain(
    target: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    size = 48.0
    resolution = 120
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for row in range(resolution + 1):
        y = -size / 2 + size * row / resolution
        for column in range(resolution + 1):
            x = -size / 2 + size * column / resolution
            vertices.append((x, y, terrain_height(x, y)))
    width = resolution + 1
    for row in range(resolution):
        for column in range(resolution):
            index = row * width + column
            faces.append(
                (
                    index,
                    index + 1,
                    index + width + 1,
                    index + width,
                )
            )
    mesh = bpy.data.meshes.new("GEO_Terrain_48m")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            uv_layer.data[loop_index].uv = (
                (vertex.co.x + size / 2) / 4.0,
                (vertex.co.y + size / 2) / 4.0,
            )
    obj = bpy.data.objects.new("Terrain_ForestFloor", mesh)
    target.objects.link(obj)
    obj.data.materials.append(material)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return obj


def create_path(
    target: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    half_width = 0.78
    segments = 100
    vertices = []
    faces = []
    for index in range(segments + 1):
        y = -25.0 + index * 50.0 / segments
        center = path_center(y)
        for side in (-1.0, 1.0):
            x = center + side * half_width
            z = terrain_height(x, y) + 0.006
            vertices.append((x, y, z))
    for index in range(segments):
        base = index * 2
        faces.append((base, base + 1, base + 3, base + 2))
    mesh = bpy.data.meshes.new("GEO_MeadowPath")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Path_DampEarth", mesh)
    target.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def prepare_asset_materials(objects: Iterable[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.type != "MESH":
            continue
        for material in obj.data.materials:
            if not material:
                continue
            if hasattr(material, "surface_render_method"):
                material.surface_render_method = "DITHERED"
            if hasattr(material, "use_transparency_overlap"):
                material.use_transparency_overlap = False


def grade_grass_materials(objects: Iterable[bpy.types.Object]) -> None:
    """Lift the scanned grass for a healthy temperate meadow without flattening detail."""
    visited: set[str] = set()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for material in obj.data.materials:
            if not material or material.name in visited or not material.use_nodes:
                continue
            visited.add(material.name)
            for node in material.node_tree.nodes:
                if node.type != "GROUP":
                    continue
                if all(name in node.inputs for name in ("Hue", "Saturation", "Value")):
                    node.inputs["Hue"].default_value = 0.56
                    node.inputs["Saturation"].default_value = 1.12
                    node.inputs["Value"].default_value = 1.48


def append_asset_variations(
    key: str,
    source: Path,
    maximum: int,
    lod: int = 0,
) -> list[bpy.types.Object]:
    if not source.exists():
        raise FileNotFoundError(
            f"Missing {source}. Run fetch_cc0_meadow_assets.py first."
        )

    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        def is_render_mesh(name: str) -> bool:
            lowered = name.lower()
            return (
                "geonodes" not in lowered
                and "geometry_nodes" not in lowered
                and "geometry nodes" not in lowered
            )

        preferred = [
            name
            for name in data_from.objects
            if name.endswith(f"_LOD{lod}") and is_render_mesh(name)
        ]
        if not preferred:
            preferred = [
                name
                for name in data_from.objects
                if is_render_mesh(name)
            ]
        data_to.objects = sorted(preferred)[:maximum]

    loaded = [
        obj
        for obj in data_to.objects
        if obj is not None and obj.type == "MESH"
    ]
    prepare_asset_materials(loaded)
    for obj in loaded:
        # Source files arrange variations in rows. The runtime instance should
        # use the mesh at its own requested scatter location.
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
        obj.name = f"SRC_{key}_{obj.name}"
    if not loaded:
        raise RuntimeError(f"No usable mesh variations found in {source}")
    return loaded


def append_material(
    source: Path,
    preferred_name: str,
    material_name: str,
) -> bpy.types.Material:
    if not source.exists():
        raise FileNotFoundError(
            f"Missing {source}. Run fetch_cc0_meadow_assets.py first."
        )
    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        candidates = [
            name
            for name in data_from.materials
            if preferred_name.lower() in name.lower()
        ]
        data_to.materials = candidates[:1] or list(data_from.materials[:1])
    material = next((item for item in data_to.materials if item), None)
    if material is None:
        raise RuntimeError(f"No material found in {source}")
    material.name = material_name
    return material


def tint_forest_floor(material: bpy.types.Material) -> None:
    """Keep the scanned PBR detail while shifting its dry albedo toward meadow green."""
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = next(
        (node for node in nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if principled is None:
        raise RuntimeError("Forest floor material has no Principled BSDF node")

    base_color = principled.inputs["Base Color"]
    source_link = next(iter(base_color.links), None)
    if source_link is None:
        original = base_color.default_value
        source_rgb = nodes.new("ShaderNodeRGB")
        source_rgb.outputs["Color"].default_value = original
        source_socket = source_rgb.outputs["Color"]
    else:
        source_socket = source_link.from_socket
        links.remove(source_link)

    tint = nodes.new("ShaderNodeMixRGB")
    tint.name = "Shenron_Meadow_Green_Tint"
    tint.label = "Subtle meadow tint over scanned forest floor"
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 0.72
    tint.inputs[2].default_value = (0.34, 0.72, 0.22, 1.0)
    links.new(source_socket, tint.inputs[1])
    links.new(tint.outputs["Color"], base_color)


def tile_scanned_material(
    material: bpy.types.Material,
    scale: tuple[float, float, float],
) -> None:
    if not material.use_nodes:
        return
    mapping_nodes = [
        node for node in material.node_tree.nodes if node.type == "MAPPING"
    ]
    if not mapping_nodes:
        raise RuntimeError(f"{material.name} has no Mapping node to tile")
    for node in mapping_nodes:
        node.inputs["Scale"].default_value = scale


def create_geometry_node_scatter(
    name: str,
    templates: list[bpy.types.Object],
    target: bpy.types.Collection,
    points: list[tuple[float, float, float]],
    scale_min: float,
    scale_max: float,
) -> bpy.types.Object:
    """Render thousands of plants as GPU instances in one draw-friendly layer."""
    source_collection = bpy.data.collections.new(f"LIB_{name}")
    for template in templates:
        source_collection.objects.link(template)

    point_mesh = bpy.data.meshes.new(f"GEO_POINTS_{name}")
    point_mesh.from_pydata(points, [], [])
    point_mesh.update()
    point_object = bpy.data.objects.new(f"Scatter_{name}", point_mesh)
    target.objects.link(point_object)

    node_group = bpy.data.node_groups.new(f"GN_{name}", "GeometryNodeTree")
    node_group.interface.new_socket(
        name="Geometry",
        in_out="INPUT",
        socket_type="NodeSocketGeometry",
    )
    node_group.interface.new_socket(
        name="Geometry",
        in_out="OUTPUT",
        socket_type="NodeSocketGeometry",
    )
    nodes = node_group.nodes
    links = node_group.links

    group_input = nodes.new("NodeGroupInput")
    group_output = nodes.new("NodeGroupOutput")
    mesh_to_points = nodes.new("GeometryNodeMeshToPoints")
    mesh_to_points.mode = "VERTICES"
    collection_info = nodes.new("GeometryNodeCollectionInfo")
    collection_info.inputs["Collection"].default_value = source_collection
    collection_info.inputs["Separate Children"].default_value = True
    collection_info.inputs["Reset Children"].default_value = True
    instance = nodes.new("GeometryNodeInstanceOnPoints")
    instance.inputs["Pick Instance"].default_value = True

    index = nodes.new("GeometryNodeInputIndex")
    modulo = nodes.new("ShaderNodeMath")
    modulo.operation = "MODULO"
    modulo.inputs[1].default_value = float(max(1, len(templates)))

    random_rotation = nodes.new("FunctionNodeRandomValue")
    random_rotation.data_type = "FLOAT_VECTOR"
    random_rotation.inputs["Min"].default_value = (0.0, 0.0, 0.0)
    random_rotation.inputs["Max"].default_value = (0.0, 0.0, math.tau)

    random_scale = nodes.new("FunctionNodeRandomValue")
    random_scale.data_type = "FLOAT"
    random_scale.inputs["Min"].default_value = scale_min
    random_scale.inputs["Max"].default_value = scale_max

    links.new(group_input.outputs["Geometry"], mesh_to_points.inputs["Mesh"])
    links.new(mesh_to_points.outputs["Points"], instance.inputs["Points"])
    links.new(collection_info.outputs["Instances"], instance.inputs["Instance"])
    links.new(index.outputs["Index"], modulo.inputs[0])
    links.new(modulo.outputs["Value"], instance.inputs["Instance Index"])
    links.new(random_rotation.outputs["Value"], instance.inputs["Rotation"])
    links.new(random_scale.outputs["Value"], instance.inputs["Scale"])
    links.new(instance.outputs["Instances"], group_output.inputs["Geometry"])

    modifier = point_object.modifiers.new(f"GN_{name}", "NODES")
    modifier.node_group = node_group
    point_object["instance_count"] = len(points)
    point_object["template_count"] = len(templates)
    return point_object


def create_instance(
    name: str,
    source: bpy.types.Object,
    target: bpy.types.Collection,
    x: float,
    y: float,
    scale: float,
    rotation: float,
    z_offset: float = 0.0,
    wind_strength: float = 0.0,
    wind_phase: float = 0.0,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, source.data)
    target.objects.link(obj)
    obj.location = (x, y, terrain_height(x, y) + z_offset)
    obj.rotation_euler = (0.0, 0.0, rotation)
    obj.scale = (scale, scale, scale)
    obj.color = (
        0.86 + random.random() * 0.14,
        0.90 + random.random() * 0.10,
        0.80 + random.random() * 0.14,
        1.0,
    )

    if wind_strength > 0.0:
        # Linked mesh, independent transform: cheap, coherent motion that stays
        # subtle enough not to read as whole-plant wobble.
        obj.rotation_mode = "XYZ"
        base_x = random.uniform(-0.015, 0.015)
        obj.rotation_euler.x = base_x
        driver = obj.driver_add("rotation_euler", 0).driver
        driver.type = "SCRIPTED"
        driver.expression = (
            f"{base_x:.6f}+sin(frame*0.035+{wind_phase:.6f})"
            f"*{wind_strength:.6f}"
        )
    return obj


def random_point(
    x_extent: float = 21.0,
    y_extent: float = 23.0,
) -> tuple[float, float]:
    return (
        random.uniform(-x_extent, x_extent),
        random.uniform(-y_extent, y_extent),
    )


def scatter_ground_layer(
    templates: dict[str, list[bpy.types.Object]],
    target: bpy.types.Collection,
    exclusions: list[tuple[float, float, float]],
) -> dict[str, int]:
    counts: dict[str, int] = {}

    grass_sources = templates["grass_a"] + templates["grass_b"]
    fine_grass_sources = [
        source
        for source in templates["grass_a"]
        if any(size in source.name.lower() for size in ("tiny", "small"))
    ] + templates["grass_c"]
    tall_grass_sources = [
        source
        for source in templates["grass_a"]
        if any(size in source.name.lower() for size in ("large", "tall"))
    ] + templates["grass_b"]
    if not fine_grass_sources or not tall_grass_sources:
        raise RuntimeError("Grass source pack does not expose expected size tiers")

    fine_grass_points: list[tuple[float, float, float]] = []
    accepted = 0
    attempts = 0
    while accepted < 180000 and attempts < 900000:
        attempts += 1
        x, y = random_point()
        path_distance = distance_from_path(x, y)
        if path_distance < 0.92:
            continue
        if any(
            math.hypot(x - ex, y - ey) < radius
            for ex, ey, radius in exclusions
        ):
            continue
        cluster = cluster_mask(x, y, 0.4)
        edge_fade = min(1.0, max(0.0, (path_distance - 0.82) / 1.8))
        if random.random() > (0.18 + cluster * 0.82) * edge_fade:
            continue
        fine_grass_points.append((x, y, terrain_height(x, y)))
        accepted += 1
    create_geometry_node_scatter(
        "Grass_Fine_Carpet",
        fine_grass_sources,
        target,
        fine_grass_points,
        0.55,
        0.92,
    )
    counts["fine_grass"] = accepted

    tall_grass_points: list[tuple[float, float, float]] = []
    accepted = 0
    attempts = 0
    while accepted < 12000 and attempts < 140000:
        attempts += 1
        x, y = random_point()
        if distance_from_path(x, y) < 1.28:
            continue
        if any(
            math.hypot(x - ex, y - ey) < radius
            for ex, ey, radius in exclusions
        ):
            continue
        cluster = cluster_mask(x, y, 1.35)
        if cluster < 0.6 or random.random() > cluster * 0.74:
            continue
        tall_grass_points.append((x, y, terrain_height(x, y)))
        accepted += 1
    create_geometry_node_scatter(
        "Grass_Tall_Accents",
        tall_grass_sources,
        target,
        tall_grass_points,
        0.62,
        1.00,
    )
    counts["tall_grass"] = accepted

    species = (
        ("fern", 480, 2.6, 0.72, 1.34, 1.8),
        ("nettle", 320, 1.35, 0.58, 0.96, 2.2),
        ("weed", 520, 1.15, 0.52, 0.92, 3.4),
        ("moss", 6500, 1.5, 0.80, 1.80, 2.9),
        ("branches", 32, 1.7, 0.74, 1.22, 4.1),
    )
    for key, requested, exclusion, scale_min, scale_max, phase in species:
        accepted = 0
        attempts = 0
        points: list[tuple[float, float, float]] = []
        while accepted < requested and attempts < requested * 90:
            attempts += 1
            x, y = random_point()
            if distance_from_path(x, y) < exclusion:
                continue
            if any(
                math.hypot(x - ex, y - ey) < radius
                for ex, ey, radius in exclusions
            ):
                continue
            cluster = cluster_mask(x, y, phase)
            threshold = 0.68 if key in {"fern", "nettle"} else 0.56
            if cluster < threshold or random.random() > cluster:
                continue
            if key == "branches":
                source = random.choice(templates[key])
                create_instance(
                    f"{key.title()}_{accepted:03d}",
                    source,
                    target,
                    x,
                    y,
                    random.uniform(scale_min, scale_max),
                    random.random() * math.tau,
                )
            else:
                points.append(
                    (
                        x,
                        y,
                        terrain_height(x, y)
                        + (0.008 if key == "moss" else 0.0),
                    )
                )
            accepted += 1
        if points:
            create_geometry_node_scatter(
                key.title(),
                templates[key],
                target,
                points,
                scale_min,
                scale_max,
            )
        counts[key] = accepted
    return counts


def scatter_structure_layer(
    templates: dict[str, list[bpy.types.Object]],
    target: bpy.types.Collection,
) -> tuple[dict[str, int], list[tuple[float, float, float]]]:
    counts: dict[str, int] = {}
    rock_exclusions: list[tuple[float, float, float]] = []

    accepted = 0
    attempts = 0
    while accepted < 22 and attempts < 2000:
        attempts += 1
        x, y = random_point(19.0, 21.0)
        if distance_from_path(x, y) < 2.4:
            continue
        if any(math.hypot(x - rx, y - ry) < rr + 1.4 for rx, ry, rr in rock_exclusions):
            continue
        size = random.uniform(0.52, 1.18)
        create_instance(
            f"RockMoss_{accepted:02d}",
            random.choice(templates["rocks"]),
            target,
            x,
            y,
            size,
            random.random() * math.tau,
            z_offset=-0.035,
        )
        rock_exclusions.append((x, y, 0.7 * size))
        accepted += 1
    counts["rocks"] = accepted

    sapling_sources = templates["pine_small"] + templates["pine_medium"]
    accepted = 0
    attempts = 0
    while accepted < 36 and attempts < 8000:
        attempts += 1
        x, y = random_point(20.0, 22.0)
        if distance_from_path(x, y) < 2.8:
            continue
        if y < 2.0 and abs(x) < 13.0:
            continue
        if cluster_mask(x, y, 5.4) < 0.59:
            continue
        if any(math.hypot(x - rx, y - ry) < rr + 0.6 for rx, ry, rr in rock_exclusions):
            continue
        create_instance(
            f"PineSapling_{accepted:02d}",
            random.choice(sapling_sources),
            target,
            x,
            y,
            random.uniform(0.68, 1.22),
            random.random() * math.tau,
            wind_strength=0.008 + random.random() * 0.008,
            wind_phase=random.random() * math.tau,
        )
        accepted += 1
    counts["saplings"] = accepted

    # Trees frame the shot and are biased toward the background/outer edges so
    # they create depth without blocking the readable path.
    tree_positions = (
        (-23.0, 8.0, 0.88),
        (23.0, 9.0, 0.92),
        (-20.0, 12.0, 0.92),
        (20.0, 13.5, 0.96),
        (-23.5, 16.0, 0.98),
        (23.0, 17.0, 1.00),
        (-17.0, 20.0, 1.06),
        (17.5, 21.0, 1.02),
        (-15.0, 22.0, 0.92),
        (-13.0, 22.5, 1.00),
        (-10.5, 23.0, 0.96),
        (-8.0, 23.5, 1.05),
        (-5.5, 23.2, 0.94),
        (-2.5, 23.8, 0.90),
        (2.0, 23.6, 0.96),
        (5.5, 23.4, 1.02),
        (8.0, 23.0, 0.93),
        (10.5, 23.2, 1.04),
        (13.5, 22.8, 1.04),
        (15.5, 22.0, 0.94),
        (-8.0, 24.0, 1.08),
        (-3.5, 23.5, 0.94),
        (3.0, 24.0, 1.02),
        (9.0, 24.0, 1.04),
    )
    for index, (x, y, size) in enumerate(tree_positions):
        create_instance(
            f"PineTree_{index:02d}",
            random.choice(templates["pine_tree"]),
            target,
            x,
            y,
            size,
            random.random() * math.tau,
            z_offset=-0.06,
            wind_strength=0.003,
            wind_phase=random.random() * math.tau,
        )
    counts["trees"] = len(tree_positions)
    for x, y, size in tree_positions:
        rock_exclusions.append((x, y, 1.35 * size))
    return counts, rock_exclusions


def create_path_details(
    target: bpy.types.Collection,
    templates: dict[str, list[bpy.types.Object]],
) -> int:
    count = 0
    for index in range(52):
        y = -22.0 + index * 44.0 / 51
        center = path_center(y)
        side = -1.0 if index % 2 else 1.0
        x = center + side * random.uniform(0.92, 1.55)
        source_pool = (
            templates["moss"]
            if index % 4
            else templates["branches"]
        )
        create_instance(
            f"PathEdgeDetail_{index:02d}",
            random.choice(source_pool),
            target,
            x,
            y + random.uniform(-0.35, 0.35),
            random.uniform(0.62, 1.05),
            random.random() * math.tau,
            z_offset=0.012,
        )
        count += 1
    return count


def create_lighting(target: bpy.types.Collection) -> None:
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputWorld")
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = 0.62
    coordinates = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.vector_type = "POINT"
    mapping.inputs["Rotation"].default_value[2] = math.radians(108.0)
    environment = nodes.new("ShaderNodeTexEnvironment")
    environment.projection = "EQUIRECTANGULAR"
    environment.image = bpy.data.images.load(
        str(ASSET_FILES["sky_hdri"]),
        check_existing=True,
    )
    links.new(coordinates.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], environment.inputs["Vector"])
    links.new(environment.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], output.inputs["Surface"])

    sun_data = bpy.data.lights.new("Sun_WarmLow", type="SUN")
    sun_data.energy = 2.25
    sun_data.angle = math.radians(5.0)
    sun_data.color = (1.0, 0.88, 0.70)
    sun = bpy.data.objects.new("Sun_WarmLow", sun_data)
    target.objects.link(sun)
    sun.rotation_euler = (
        math.radians(34.0),
        math.radians(-20.0),
        math.radians(-128.0),
    )

    area_data = bpy.data.lights.new("Area_SkyFill", type="AREA")
    area_data.energy = 1200.0
    area_data.shape = "DISK"
    area_data.size = 14.0
    area_data.color = (0.82, 0.90, 1.0)
    area = bpy.data.objects.new("Area_SkyFill", area_data)
    target.objects.link(area)
    area.location = (7.0, -10.0, 15.0)
    look_at(area, Vector((0.0, 4.0, 0.0)))

    rim_data = bpy.data.lights.new("Area_BackRim", type="AREA")
    rim_data.energy = 520.0
    rim_data.shape = "RECTANGLE"
    rim_data.size = 7.0
    rim_data.color = (1.0, 0.72, 0.46)
    rim = bpy.data.objects.new("Area_BackRim", rim_data)
    target.objects.link(rim)
    rim.location = (9.0, 15.0, 8.0)
    look_at(rim, Vector((0.0, 5.0, 1.0)))


def create_camera(target: bpy.types.Collection) -> bpy.types.Object:
    camera_data = bpy.data.cameras.new("Camera_MeadowHero")
    camera = bpy.data.objects.new("Camera_MeadowHero", camera_data)
    target.objects.link(camera)
    camera.location = (3.0, -18.8, 1.28)
    camera_data.lens = 52.0
    camera_data.sensor_width = 36.0

    focus = bpy.data.objects.new("DOF_Focus_PathBend", None)
    target.objects.link(focus)
    focus.location = (path_center(4.5), 4.5, 0.52)
    camera_data.dof.use_dof = True
    camera_data.dof.focus_object = focus
    camera_data.dof.aperture_fstop = 4.8
    camera_data.dof.aperture_blades = 7
    look_at(camera, Vector((path_center(4.5), 4.5, 0.52)))
    bpy.context.scene.camera = camera
    return camera


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 38
    scene.render.fps = 30
    scene.frame_start = 1
    scene.frame_end = 240
    scene.frame_set(74)

    if hasattr(scene, "eevee"):
        scene.eevee.taa_samples = 64
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.18

    # Grounding contact shadows plus a controlled cinematic grade.
    # Blender 5.1 moved compositor ownership away from Scene.node_tree. Keep
    # the source compatible with 4.x and let 5.1 render the physically lit
    # image directly rather than relying on a version-specific grade.
    if hasattr(scene, "node_tree"):
        scene.use_nodes = True
        nodes = scene.node_tree.nodes
        links = scene.node_tree.links
        nodes.clear()
        render_layers = nodes.new("CompositorNodeRLayers")
        glare = nodes.new("CompositorNodeGlare")
        glare.glare_type = "FOG_GLOW"
        glare.quality = "HIGH"
        glare.threshold = 1.35
        glare.size = 6
        lens = nodes.new("CompositorNodeLensdist")
        lens.inputs["Distortion"].default_value = 0.006
        lens.inputs["Dispersion"].default_value = 0.004
        composite = nodes.new("CompositorNodeComposite")
        links.new(render_layers.outputs["Image"], glare.inputs["Image"])
        links.new(glare.outputs["Image"], lens.inputs["Image"])
        links.new(lens.outputs["Image"], composite.inputs["Image"])


def main() -> None:
    output_path = BLEND_PATH
    if "--output-path" in sys.argv:
        index = sys.argv.index("--output-path")
        try:
            output_path = Path(sys.argv[index + 1]).resolve()
        except IndexError as error:
            raise ValueError("--output-path requires a following file path") from error

    missing = [path for path in ASSET_FILES.values() if not path.exists()]
    if missing:
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise FileNotFoundError(
            "The reviewed CC0 source pack is incomplete:\n"
            f"{formatted}\n"
            "Run fetch_cc0_meadow_assets.py first."
        )

    clear_scene()
    scene_root = collection("SHENRON_AAA_MEADOW")
    terrain_group = collection("01_Terrain", scene_root)
    scatter_group = collection("02_Biome_Scatter", scene_root)
    structure_group = collection("03_Rocks_Saplings_Trees", scene_root)
    details_group = collection("04_Path_Edge_Details", scene_root)
    lighting_group = collection("05_Lighting_Camera", scene_root)

    forest_floor = append_material(
        ASSET_FILES["forest_floor"],
        "forest_ground_04",
        "M_ForestGround04_CC0",
    )
    tint_forest_floor(forest_floor)
    create_terrain(terrain_group, forest_floor)
    path_surface = append_material(
        ASSET_FILES["path_surface"],
        "brown_mud_leaves_01",
        "M_BrownMudLeaves01_CC0",
    )
    tile_scanned_material(path_surface, (2.0, 24.0, 2.0))
    create_path(terrain_group, path_surface)

    limits = {
        "grass_a": 18,
        "grass_b": 18,
        "grass_c": 18,
        "fern": 12,
        "nettle": 12,
        "weed": 12,
        "moss": 12,
        "branches": 10,
        "rocks": 12,
        "pine_small": 10,
        "pine_medium": 10,
        "pine_tree": 5,
    }
    source_lods = {
        "grass_a": 1,
        "grass_b": 1,
        "grass_c": 1,
        "fern": 1,
        "nettle": 1,
        "weed": 1,
        "moss": 1,
        "branches": 0,
        "rocks": 0,
        "pine_small": 1,
        "pine_medium": 1,
        "pine_tree": 1,
    }
    template_files = {
        key: path
        for key, path in ASSET_FILES.items()
        if key not in {"forest_floor", "path_surface", "sky_hdri"}
    }
    templates = {
        key: append_asset_variations(
            key,
            path,
            limits[key],
            lod=source_lods[key],
        )
        for key, path in template_files.items()
    }
    grade_grass_materials(
        templates["grass_a"] + templates["grass_b"] + templates["grass_c"]
    )
    structure_counts, exclusions = scatter_structure_layer(
        templates,
        structure_group,
    )
    ground_counts = scatter_ground_layer(
        templates,
        scatter_group,
        exclusions,
    )
    path_details = create_path_details(details_group, templates)
    create_lighting(lighting_group)
    create_camera(lighting_group)
    configure_render()

    scene = bpy.context.scene
    scene["shenron_scene_version"] = "1.0.0"
    scene["source_license"] = "CC0-1.0"
    scene["source_provider"] = "Poly Haven public API"
    scene["distribution_seed"] = SEED
    scene["ground_layer_counts"] = str(ground_counts)
    scene["structure_layer_counts"] = str(structure_counts)
    scene["path_edge_details"] = path_details
    scene["reference_method"] = (
        "multi-species layers + clustered masks + exclusions + subtle wind"
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Make the authoring file portable. All packed images are CC0 and recorded
    # by the adjacent API receipt.
    try:
        bpy.ops.file.pack_all()
    except RuntimeError as error:
        print(f"Warning: Blender could not pack every source image: {error}")
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
    skip_render = "--skip-render" in sys.argv
    if not skip_render:
        bpy.context.scene.render.filepath = str(PREVIEW_PATH)
        bpy.ops.render.render(write_still=True)

    print(f"Saved: {output_path}")
    print(f"Rendered: {PREVIEW_PATH}" if not skip_render else "Render skipped by request.")
    print(f"Ground layer: {ground_counts}")
    print(f"Structure layer: {structure_counts}")
    print(f"Path-edge details: {path_details}")


if __name__ == "__main__":
    main()
