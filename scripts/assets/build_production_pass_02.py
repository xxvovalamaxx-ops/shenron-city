"""Author the Production Pass 02 modular city kit in the open Blender project.

This script is designed for Blender 5.1 and is executed through the official
Blender MCP bridge. It creates editable, dimensioned source geometry, assigns
PBR material slots, records stable asset IDs, saves a new .blend file, and
exports browser-ready GLBs without modifying the earlier meadow source file.
"""

from __future__ import annotations

import math
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
    / "Shenzhen_City_Production_Pass_02.blend"
)
RUNTIME = ROOT / "public" / "assets" / "production"

for path in (
    RUNTIME / "architecture",
    RUNTIME / "interiors",
    RUNTIME / "vehicles",
    RUNTIME / "props",
    RUNTIME / "collision",
):
    path.mkdir(parents=True, exist_ok=True)


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
    for existing in list(bpy.data.collections):
        bpy.data.collections.remove(existing)


def collection(name: str) -> bpy.types.Collection:
    value = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(value)
    return value


def move_to(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)


def material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metalness: float = 0.0,
    *,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    transmission: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    value.surface_render_method = "DITHERED" if alpha < 1.0 else "DITHERED"
    bsdf = value.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metalness
    bsdf.inputs["Alpha"].default_value = alpha
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return value


clear_scene()


MATERIALS = {
    "concrete": material("MAT_Concrete", (0.16, 0.18, 0.20, 1), 0.78),
    "stone": material("MAT_Stone", (0.28, 0.29, 0.30, 1), 0.65),
    "plaster": material("MAT_Plaster", (0.34, 0.30, 0.27, 1), 0.82),
    "brick": material("MAT_Brick", (0.30, 0.12, 0.075, 1), 0.88),
    "asphalt": material("MAT_Asphalt", (0.025, 0.03, 0.037, 1), 0.94),
    "sidewalk": material("MAT_Sidewalk", (0.25, 0.27, 0.28, 1), 0.9),
    "metal": material("MAT_Metal", (0.10, 0.12, 0.14, 1), 0.28, 0.86),
    "black_metal": material("MAT_BlackMetal", (0.018, 0.022, 0.027, 1), 0.32, 0.9),
    "glass": material(
        "MAT_Glass",
        (0.035, 0.08, 0.11, 0.34),
        0.08,
        0.05,
        transmission=0.46,
        alpha=0.34,
    ),
    "warm_glass": material(
        "MAT_WarmGlass",
        (0.22, 0.14, 0.07, 0.72),
        0.2,
        emission=(1.0, 0.36, 0.08, 1),
        emission_strength=0.8,
        alpha=0.72,
    ),
    "wood": material("MAT_Wood", (0.24, 0.11, 0.045, 1), 0.72),
    "canvas_red": material("MAT_CanvasRed", (0.42, 0.035, 0.025, 1), 0.76),
    "canvas_amber": material("MAT_CanvasAmber", (0.55, 0.20, 0.025, 1), 0.74),
    "canvas_green": material("MAT_CanvasGreen", (0.025, 0.22, 0.12, 1), 0.78),
    "canvas_blue": material("MAT_CanvasBlue", (0.025, 0.14, 0.36, 1), 0.76),
    "canvas_pink": material("MAT_CanvasPink", (0.46, 0.04, 0.19, 1), 0.76),
    "canvas_cream": material("MAT_CanvasCream", (0.58, 0.48, 0.30, 1), 0.8),
    "white_line": material("MAT_RoadWhite", (0.62, 0.64, 0.61, 1), 0.76),
    "yellow_line": material("MAT_RoadYellow", (0.72, 0.47, 0.06, 1), 0.72),
    "rubber": material("MAT_Rubber", (0.008, 0.009, 0.011, 1), 0.83),
    "chrome": material("MAT_Chrome", (0.42, 0.46, 0.48, 1), 0.12, 1.0),
    "red_light": material(
        "MAT_RedLight",
        (0.32, 0.005, 0.003, 1),
        0.18,
        emission=(1.0, 0.005, 0.001, 1),
        emission_strength=5.0,
    ),
    "white_light": material(
        "MAT_WhiteLight",
        (0.8, 0.84, 0.75, 1),
        0.14,
        emission=(1.0, 0.78, 0.52, 1),
        emission_strength=4.0,
    ),
    "green": material("MAT_PlanterGreen", (0.025, 0.16, 0.055, 1), 0.95),
    "soil": material("MAT_Soil", (0.055, 0.025, 0.012, 1), 1.0),
    "screen": material(
        "MAT_Screen",
        (0.008, 0.11, 0.13, 1),
        0.2,
        emission=(0.01, 0.55, 0.62, 1),
        emission_strength=1.3,
    ),
}


def tag(obj: bpy.types.Object, asset_id: str, role: str = "render") -> None:
    obj["asset_id"] = asset_id
    obj["production_role"] = role
    obj["source"] = "project-authored"
    obj["license"] = "Project-owned"


def rounded_box(
    target: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    bevel: float = 0.04,
    asset_id: str | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Production_Bevel", "BEVEL")
        modifier.width = min(bevel, min(dimensions) * 0.22)
        modifier.segments = 3
    obj.data.materials.append(mat)
    move_to(obj, target)
    tag(obj, asset_id or name)
    return obj


def cylinder(
    target: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 20,
    rotation: tuple[float, float, float] = (0, 0, 0),
    asset_id: str | None = None,
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
    obj.data.materials.append(mat)
    modifier = obj.modifiers.new("Edge_Soften", "BEVEL")
    modifier.width = min(0.025, radius * 0.12)
    modifier.segments = 2
    move_to(obj, target)
    tag(obj, asset_id or name)
    return obj


def text_mesh(
    target: bpy.types.Collection,
    name: str,
    text: str,
    location: tuple[float, float, float],
    scale: float,
    mat: bpy.types.Material,
    rotation: tuple[float, float, float] = (math.pi / 2, 0, 0),
) -> bpy.types.Object:
    bpy.ops.object.text_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.extrude = 0.018
    obj.data.bevel_depth = 0.006
    obj.scale = (scale, scale, scale)
    obj.data.materials.append(mat)
    bpy.ops.object.convert(target="MESH")
    move_to(obj, target)
    tag(obj, name)
    return obj


def root_empty(target: bpy.types.Collection, name: str, asset_id: str) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    target.objects.link(obj)
    tag(obj, asset_id)
    return obj


def parent_objects(parent: bpy.types.Object, objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        obj.parent = parent


def build_ground(target: bpy.types.Collection) -> None:
    rounded_box(
        target,
        "HQ_PLAZA_PAVING",
        (0, -0.045, 17),
        (56, 0.16, 34),
        MATERIALS["sidewalk"],
        bevel=0.025,
        asset_id="plaza.hq.paving.lod0",
    )
    rounded_box(
        target,
        "HQ_PLAZA_APPROACH",
        (0, 0.045, 17),
        (10.5, 0.08, 34),
        MATERIALS["stone"],
        bevel=0.02,
        asset_id="plaza.hq.approach.lod0",
    )
    for index in range(7):
        rounded_box(
            target,
            f"HQ_PLAZA_JOINT_{index}",
            (-24 + index * 8, 0.045, 17),
            (0.035, 0.012, 33.5),
            MATERIALS["black_metal"],
            bevel=0.002,
            asset_id=f"plaza.hq.expansion-joint.{index}",
        )
    rounded_box(
        target,
        "ROAD_DragonBoulevard",
        (0, -0.035, 92),
        (15, 0.12, 116),
        MATERIALS["asphalt"],
        bevel=0.015,
        asset_id="road.dragon-boulevard.lod0",
    )
    for side in (-1, 1):
        rounded_box(
            target,
            f"SIDEWALK_{side}",
            (side * 10, 0.045, 92),
            (5, 0.18, 116),
            MATERIALS["sidewalk"],
            bevel=0.025,
            asset_id=f"sidewalk.dragon-boulevard.{side}.lod0",
        )
        rounded_box(
            target,
            f"CURB_{side}",
            (side * 7.55, 0.12, 92),
            (0.22, 0.25, 116),
            MATERIALS["stone"],
            bevel=0.025,
            asset_id=f"curb.dragon-boulevard.{side}.lod0",
        )
        rounded_box(
            target,
            f"GUTTER_{side}",
            (side * 7.34, 0.015, 92),
            (0.22, 0.03, 116),
            MATERIALS["black_metal"],
            bevel=0.005,
            asset_id=f"gutter.dragon-boulevard.{side}.lod0",
        )
    for z in range(42, 151, 12):
        rounded_box(
            target,
            f"LANE_MARK_{z}",
            (0, 0.035, z),
            (0.14, 0.018, 5.2),
            MATERIALS["yellow_line"],
            bevel=0.006,
            asset_id=f"road-marking.center.{z}",
        )
    for index in range(8):
        rounded_box(
            target,
            f"CROSSWALK_{index}",
            (-5.3 + index * 1.52, 0.04, 39.5),
            (0.82, 0.02, 4.8),
            MATERIALS["white_line"],
            bevel=0.005,
            asset_id=f"road-marking.crosswalk.{index:02d}",
        )
    for z in (52, 80, 108, 136):
        for side in (-1, 1):
            rounded_box(
                target,
                f"DRAIN_{side}_{z}",
                (side * 7.32, 0.045, z),
                (0.32, 0.025, 0.9),
                MATERIALS["black_metal"],
                bevel=0.012,
                asset_id=f"street.drain.{side}.{z}",
            )
            for slot in range(5):
                rounded_box(
                    target,
                    f"DRAIN_SLOT_{side}_{z}_{slot}",
                    (side * 7.30, 0.064, z - 0.3 + slot * 0.15),
                    (0.2, 0.012, 0.035),
                    MATERIALS["asphalt"],
                    bevel=0.003,
                    asset_id=f"street.drain-slot.{side}.{z}.{slot}",
                )
    cylinder(
        target,
        "MANHOLE_01",
        (-3.6, 0.055, 71),
        0.48,
        0.035,
        MATERIALS["black_metal"],
        vertices=40,
        asset_id="street.manhole.01",
    )
    cylinder(
        target,
        "MANHOLE_02",
        (3.6, 0.055, 124),
        0.48,
        0.035,
        MATERIALS["black_metal"],
        vertices=40,
        asset_id="street.manhole.02",
    )


BUILDINGS = [
    ("west-arcade", -37, 58, 19, 19, 15, 4, "brick"),
    ("west-records", -37, 83, 19, 20, 18, 5, "concrete"),
    ("west-noodle", -37, 109, 19, 20, 13, 3, "plaster"),
    ("west-cinema", -37, 135, 19, 20, 22, 6, "stone"),
    ("east-cycles", 29, 58, 20, 22, 17, 4, "concrete"),
    ("east-tea", 29, 112, 20, 22, 15, 4, "brick"),
    ("east-hotel", 29, 140, 20, 22, 26, 7, "stone"),
]


def build_storefront(
    target: bpy.types.Collection,
    ident: str,
    x: float,
    z: float,
    width: float,
    depth: float,
    height: float,
    floors: int,
    finish: str,
) -> None:
    root = root_empty(target, f"BLDG_{ident}", f"architecture.{ident}.lod0")
    parts: list[bpy.types.Object] = []
    parts.append(
        rounded_box(
            target,
            f"{ident}_SHELL",
            (x, height / 2, z),
            (width, height, depth),
            MATERIALS[finish],
            bevel=0.16,
            asset_id=f"architecture.{ident}.shell",
        )
    )
    face_x = x + width / 2 + 0.045 if x < 0 else x - width / 2 - 0.045
    frame_depth = 0.14
    direction = 1 if x < 0 else -1
    bay_count = 4 if depth >= 20 else 3
    bay_width = (depth - 2.2) / bay_count
    ground_height = 3.35

    parts.append(
        rounded_box(
            target,
            f"{ident}_PLINTH",
            (face_x + direction * 0.05, 0.45, z),
            (frame_depth, 0.9, depth - 0.55),
            MATERIALS["stone"],
            bevel=0.035,
            asset_id=f"architecture.{ident}.plinth",
        )
    )
    for bay in range(bay_count):
        bay_z = z - (bay_count - 1) * bay_width / 2 + bay * bay_width
        parts.append(
            rounded_box(
                target,
                f"{ident}_SHOP_GLASS_{bay}",
                (face_x + direction * 0.08, 1.85, bay_z),
                (0.05, 2.35, bay_width - 0.42),
                MATERIALS["warm_glass"],
                bevel=0.018,
                asset_id=f"architecture.{ident}.shop-glass.{bay}",
            )
        )
        for edge in (-1, 1):
            parts.append(
                rounded_box(
                    target,
                    f"{ident}_SHOP_MULLION_{bay}_{edge}",
                    (face_x + direction * 0.13, 1.85, bay_z + edge * (bay_width - 0.42) / 2),
                    (0.11, 2.55, 0.09),
                    MATERIALS["black_metal"],
                    bevel=0.018,
                    asset_id=f"architecture.{ident}.shop-mullion.{bay}.{edge}",
                )
            )
    parts.append(
        rounded_box(
            target,
            f"{ident}_CANOPY",
            (face_x + direction * 0.72, ground_height, z),
            (1.5, 0.16, depth - 1.0),
            MATERIALS["black_metal"],
            bevel=0.07,
            asset_id=f"architecture.{ident}.canopy",
        )
    )
    floor_height = (height - ground_height) / max(1, floors - 1)
    for floor in range(1, floors):
        y = ground_height + floor_height * (floor - 0.45)
        parts.append(
            rounded_box(
                target,
                f"{ident}_FLOOR_BAND_{floor}",
                (face_x + direction * 0.06, y - floor_height / 2, z),
                (0.14, 0.18, depth - 0.35),
                MATERIALS["black_metal"],
                bevel=0.025,
                asset_id=f"architecture.{ident}.floor-band.{floor}",
            )
        )
        for bay in range(bay_count):
            bay_z = z - (bay_count - 1) * bay_width / 2 + bay * bay_width
            lit = (bay + floor + int(abs(x))) % 3 != 0
            parts.append(
                rounded_box(
                    target,
                    f"{ident}_WINDOW_{floor}_{bay}",
                    (face_x + direction * 0.07, y, bay_z),
                    (0.055, min(1.9, floor_height * 0.6), bay_width - 0.7),
                    MATERIALS["warm_glass" if lit else "glass"],
                    bevel=0.025,
                    asset_id=f"architecture.{ident}.window.{floor}.{bay}",
                )
            )
            parts.append(
                rounded_box(
                    target,
                    f"{ident}_SILL_{floor}_{bay}",
                    (
                        face_x + direction * 0.14,
                        y - min(1.9, floor_height * 0.6) / 2 - 0.07,
                        bay_z,
                    ),
                    (0.22, 0.12, bay_width - 0.54),
                    MATERIALS["stone"],
                    bevel=0.025,
                    asset_id=f"architecture.{ident}.sill.{floor}.{bay}",
                )
            )
    # Corners, parapet, rooftop mechanical units, drainage, and service door.
    for edge in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"{ident}_CORNER_{edge}",
                (face_x + direction * 0.11, height / 2, z + edge * (depth / 2 - 0.26)),
                (0.28, height - 0.35, 0.52),
                MATERIALS["stone"],
                bevel=0.045,
                asset_id=f"architecture.{ident}.corner.{edge}",
            )
        )
    parts.append(
        rounded_box(
            target,
            f"{ident}_PARAPET",
            (x, height + 0.42, z),
            (width + 0.15, 0.85, depth + 0.15),
            MATERIALS["stone"],
            bevel=0.08,
            asset_id=f"architecture.{ident}.parapet",
        )
    )
    for unit in range(2):
        parts.append(
            rounded_box(
                target,
                f"{ident}_HVAC_{unit}",
                (x + (-2.4 if unit == 0 else 2.1), height + 1.25, z + (-2.3 + unit * 4.4)),
                (2.2, 1.1, 2.5),
                MATERIALS["metal"],
                bevel=0.08,
                asset_id=f"architecture.{ident}.hvac.{unit}",
            )
        )
    pipe_x = x + direction * (width / 2 + 0.17)
    parts.append(
        cylinder(
            target,
            f"{ident}_DRAIN_PIPE",
            (pipe_x, height * 0.42, z + depth * 0.34),
            0.085,
            height * 0.82,
            MATERIALS["black_metal"],
            vertices=16,
            asset_id=f"architecture.{ident}.drain-pipe",
        )
    )
    parent_objects(root, parts)


def build_hq(target: bpy.types.Collection) -> None:
    root = root_empty(target, "HQ_TOWER_ROOT", "architecture.hq-tower.lod0")
    parts: list[bpy.types.Object] = []
    parts.append(
        rounded_box(
            target,
            "HQ_TOWER_CORE",
            (0, 60, -20),
            (52, 120, 40),
            MATERIALS["concrete"],
            bevel=0.35,
            asset_id="architecture.hq-tower.core",
        )
    )
    # Deep curtain-wall bays instead of a glowing texture grid.
    for floor in range(3, 39):
        y = floor * 3.0
        for bay in range(-8, 9):
            x = bay * 2.85
            lit = (bay * 7 + floor * 11) % 5 not in (0, 1)
            parts.append(
                rounded_box(
                    target,
                    f"HQ_WINDOW_{floor}_{bay}",
                    (x, y, 0.22),
                    (2.35, 2.15, 0.11),
                    MATERIALS["warm_glass" if lit else "glass"],
                    bevel=0.045,
                    asset_id=f"architecture.hq-tower.window.{floor}.{bay}",
                )
            )
        parts.append(
            rounded_box(
                target,
                f"HQ_SPANDREL_{floor}",
                (0, y - 1.35, 0.42),
                (50.2, 0.22, 0.3),
                MATERIALS["black_metal"],
                bevel=0.045,
                asset_id=f"architecture.hq-tower.spandrel.{floor}",
            )
        )
    for bay in range(-9, 10):
        parts.append(
            rounded_box(
                target,
                f"HQ_MULLION_{bay}",
                (bay * 2.85, 61, 0.48),
                (0.15, 116, 0.24),
                MATERIALS["black_metal"],
                bevel=0.035,
                asset_id=f"architecture.hq-tower.mullion.{bay}",
            )
        )
    # Podium and entrance: layered structure with frames, tracks and sensors.
    parts.append(
        rounded_box(
            target,
            "HQ_PODIUM",
            (0, 6.2, -1.15),
            (46, 12.4, 3.1),
            MATERIALS["stone"],
            bevel=0.18,
            asset_id="architecture.hq-podium.shell",
        )
    )
    parts.append(
        rounded_box(
            target,
            "HQ_ENTRANCE_RECESS",
            (0, 2.3, 0.48),
            (7.4, 4.7, 0.22),
            MATERIALS["glass"],
            bevel=0.07,
            asset_id="architecture.hq-entrance.glazing",
        )
    )
    parts.append(
        rounded_box(
            target,
            "HQ_CANOPY",
            (0, 5.25, 3.35),
            (14.2, 0.38, 6.8),
            MATERIALS["black_metal"],
            bevel=0.13,
            asset_id="architecture.hq-entrance.canopy",
        )
    )
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"HQ_CANOPY_COLUMN_{side}",
                (side * 5.4, 2.75, 5.1),
                (0.42, 5.5, 0.55),
                MATERIALS["chrome"],
                bevel=0.09,
                asset_id=f"architecture.hq-entrance.column.{side}",
            )
        )
        parts.append(
            rounded_box(
                target,
                f"HQ_DOOR_JAMB_{side}",
                (side * 3.55, 2.2, 0.64),
                (0.22, 4.6, 0.32),
                MATERIALS["black_metal"],
                bevel=0.045,
                asset_id=f"architecture.hq-entrance.door-jamb.{side}",
            )
        )
    parts.append(
        rounded_box(
            target,
            "HQ_DOOR_HEADER",
            (0, 4.48, 0.64),
            (7.35, 0.26, 0.34),
            MATERIALS["black_metal"],
            bevel=0.05,
            asset_id="architecture.hq-entrance.door-header",
        )
    )
    parts.append(
        rounded_box(
            target,
            "HQ_DOOR_TRACK",
            (0, 0.035, 0.66),
            (7.25, 0.045, 0.36),
            MATERIALS["chrome"],
            bevel=0.015,
            asset_id="architecture.hq-entrance.door-track",
        )
    )
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"HQ_SENSOR_{side}",
                (side * 1.2, 4.22, 0.83),
                (0.2, 0.12, 0.22),
                MATERIALS["screen"],
                bevel=0.04,
                asset_id=f"architecture.hq-entrance.sensor.{side}",
            )
        )
    text_mesh(
        target,
        "HQ_SIGN_SHENRON",
        "SHENRON",
        (0, 7.1, 0.58),
        0.82,
        MATERIALS["white_light"],
        rotation=(math.pi / 2, 0, 0),
    )
    # Plaza planters, soil, bollards, security cameras.
    for x in (-9, 9):
        for z in (10, 18, 26):
            parts.append(
                rounded_box(
                    target,
                    f"HQ_PLANTER_{x}_{z}",
                    (x, 0.36, z),
                    (2.4, 0.72, 2.4),
                    MATERIALS["stone"],
                    bevel=0.12,
                    asset_id=f"prop.planter.hq.{x}.{z}",
                )
            )
            parts.append(
                rounded_box(
                    target,
                    f"HQ_PLANTER_SOIL_{x}_{z}",
                    (x, 0.71, z),
                    (2.1, 0.06, 2.1),
                    MATERIALS["soil"],
                    bevel=0.03,
                    asset_id=f"prop.planter-soil.hq.{x}.{z}",
                )
            )
    for z in (6, 14, 22, 30):
        for x in (-5, 5):
            parts.append(
                cylinder(
                    target,
                    f"HQ_BOLLARD_{x}_{z}",
                    (x, 0.53, z),
                    0.11,
                    1.06,
                    MATERIALS["black_metal"],
                    vertices=24,
                    asset_id=f"prop.bollard.hq.{x}.{z}",
                )
            )
    for side in (-1, 1):
        arm = rounded_box(
            target,
            f"HQ_CAMERA_ARM_{side}",
            (side * 4.8, 4.35, 0.95),
            (0.45, 0.08, 0.08),
            MATERIALS["black_metal"],
            bevel=0.025,
            asset_id=f"prop.security-camera.arm.{side}",
        )
        body = rounded_box(
            target,
            f"HQ_CAMERA_BODY_{side}",
            (side * 5.0, 4.25, 1.08),
            (0.28, 0.18, 0.34),
            MATERIALS["black_metal"],
            bevel=0.055,
            asset_id=f"prop.security-camera.body.{side}",
        )
        parts.extend((arm, body))
    parent_objects(root, parts)


def build_market(target: bpy.types.Collection) -> None:
    stalls = [
        ("ramen", 16.5, 78, "canvas_red"),
        ("tea", 16.5, 86, "canvas_amber"),
        ("flowers", 16.5, 94, "canvas_pink"),
        ("books", 16.5, 102, "canvas_blue"),
        ("craft", 21.0, 82, "canvas_green"),
        ("bakery", 21.0, 98, "canvas_cream"),
    ]
    for ident, x, z, canvas in stalls:
        root = root_empty(target, f"MARKET_{ident}", f"market.stall.{ident}.lod0")
        parts: list[bpy.types.Object] = []
        for dx in (-1.65, 1.65):
            for dz in (-1.05, 1.05):
                parts.append(
                    rounded_box(
                        target,
                        f"{ident}_POST_{dx}_{dz}",
                        (x + dx, 1.3, z + dz),
                        (0.09, 2.6, 0.09),
                        MATERIALS["black_metal"],
                        bevel=0.025,
                        asset_id=f"market.{ident}.post.{dx}.{dz}",
                    )
                )
        parts.append(
            rounded_box(
                target,
                f"{ident}_AWNING",
                (x, 2.52, z),
                (3.75, 0.16, 2.65),
                MATERIALS[canvas],
                bevel=0.12,
                asset_id=f"market.{ident}.awning",
            )
        )
        parts.append(
            rounded_box(
                target,
                f"{ident}_COUNTER",
                (x - 1.42, 0.95, z),
                (0.62, 0.14, 2.25),
                MATERIALS["wood"],
                bevel=0.055,
                asset_id=f"market.{ident}.counter",
            )
        )
        for shelf in range(2):
            parts.append(
                rounded_box(
                    target,
                    f"{ident}_SHELF_{shelf}",
                    (x + 1.25, 0.62 + shelf * 0.68, z),
                    (0.42, 0.08, 2.1),
                    MATERIALS["wood"],
                    bevel=0.035,
                    asset_id=f"market.{ident}.shelf.{shelf}",
                )
            )
        for item in range(8):
            iz = z - 0.82 + (item % 4) * 0.55
            iy = 0.78 + (item // 4) * 0.68
            parts.append(
                rounded_box(
                    target,
                    f"{ident}_MERCH_{item}",
                    (x + 1.15, iy, iz),
                    (0.28 + (item % 2) * 0.08, 0.22 + (item % 3) * 0.07, 0.34),
                    MATERIALS[["canvas_red", "canvas_amber", "canvas_green", "canvas_blue"][item % 4]],
                    bevel=0.045,
                    asset_id=f"market.{ident}.merchandise.{item}",
                )
            )
        for lamp in (-0.75, 0.75):
            parts.append(
                cylinder(
                    target,
                    f"{ident}_LAMP_{lamp}",
                    (x, 2.26, z + lamp),
                    0.11,
                    0.18,
                    MATERIALS["white_light"],
                    vertices=20,
                    asset_id=f"market.{ident}.lamp.{lamp}",
                )
            )
        parent_objects(root, parts)


def build_street_props(target: bpy.types.Collection) -> None:
    for index, z in enumerate(range(44, 149, 14)):
        for side in (-1, 1):
            x = side * 8.75
            root = root_empty(
                target,
                f"BENCH_{side}_{index}",
                f"prop.bench.{side}.{index}.lod0",
            )
            parts = [
                rounded_box(
                    target,
                    f"BENCH_SEAT_{side}_{index}",
                    (x, 0.48, z),
                    (0.55, 0.12, 1.85),
                    MATERIALS["wood"],
                    bevel=0.05,
                    asset_id=f"prop.bench-seat.{side}.{index}",
                ),
                rounded_box(
                    target,
                    f"BENCH_BACK_{side}_{index}",
                    (x + side * 0.22, 0.78, z),
                    (0.09, 0.54, 1.85),
                    MATERIALS["wood"],
                    bevel=0.04,
                    asset_id=f"prop.bench-back.{side}.{index}",
                ),
            ]
            for dz in (-0.65, 0.65):
                parts.append(
                    rounded_box(
                        target,
                        f"BENCH_LEG_{side}_{index}_{dz}",
                        (x, 0.22, z + dz),
                        (0.46, 0.44, 0.08),
                        MATERIALS["black_metal"],
                        bevel=0.035,
                        asset_id=f"prop.bench-leg.{side}.{index}.{dz}",
                    )
                )
            parent_objects(root, parts)
    for index, z in enumerate((50, 78, 106, 134)):
        for side in (-1, 1):
            x = side * 8.65
            cylinder(
                target,
                f"TRASH_BODY_{side}_{index}",
                (x, 0.42, z),
                0.25,
                0.84,
                MATERIALS["black_metal"],
                vertices=28,
                asset_id=f"prop.trash-bin.{side}.{index}.lod0",
            )
            cylinder(
                target,
                f"TRASH_RING_{side}_{index}",
                (x, 0.84, z),
                0.28,
                0.07,
                MATERIALS["chrome"],
                vertices=28,
                asset_id=f"prop.trash-bin-ring.{side}.{index}",
            )
    # Lamp poles with arms and physical luminaires.
    for index, z in enumerate((52, 76, 100, 124, 148)):
        for side in (-1, 1):
            x = side * 8.8
            cylinder(
                target,
                f"LAMP_POLE_{side}_{index}",
                (x, 2.3, z),
                0.09,
                4.6,
                MATERIALS["black_metal"],
                vertices=20,
                asset_id=f"prop.streetlight.pole.{side}.{index}",
            )
            rounded_box(
                target,
                f"LAMP_ARM_{side}_{index}",
                (x - side * 0.42, 4.48, z),
                (0.84, 0.08, 0.08),
                MATERIALS["black_metal"],
                bevel=0.025,
                asset_id=f"prop.streetlight.arm.{side}.{index}",
            )
            rounded_box(
                target,
                f"LAMP_HEAD_{side}_{index}",
                (x - side * 0.78, 4.4, z),
                (0.44, 0.14, 0.25),
                MATERIALS["white_light"],
                bevel=0.055,
                asset_id=f"prop.streetlight.head.{side}.{index}",
            )
    # Distinct street vocabulary: hydrants, meters, cabinets, racks, shelter.
    for index, z in enumerate((63, 121)):
        cylinder(
            target,
            f"HYDRANT_{index}",
            (-9.25, 0.36, z),
            0.16,
            0.58,
            MATERIALS["canvas_red"],
            vertices=24,
            asset_id=f"prop.hydrant.{index}.lod0",
        )
        cylinder(
            target,
            f"HYDRANT_CAP_{index}",
            (-9.25, 0.68, z),
            0.2,
            0.12,
            MATERIALS["chrome"],
            vertices=24,
            asset_id=f"prop.hydrant-cap.{index}",
        )
    for index, z in enumerate((70, 98, 126)):
        cylinder(
            target,
            f"PARKING_METER_{index}",
            (9.15, 0.72, z),
            0.055,
            1.42,
            MATERIALS["black_metal"],
            vertices=16,
            asset_id=f"prop.parking-meter.post.{index}",
        )
        rounded_box(
            target,
            f"PARKING_METER_HEAD_{index}",
            (9.15, 1.48, z),
            (0.28, 0.36, 0.22),
            MATERIALS["metal"],
            bevel=0.065,
            asset_id=f"prop.parking-meter.head.{index}",
        )
    for index, z in enumerate((74, 132)):
        rounded_box(
            target,
            f"UTILITY_CABINET_{index}",
            (-9.45, 0.65, z),
            (0.75, 1.3, 0.48),
            MATERIALS["metal"],
            bevel=0.075,
            asset_id=f"prop.utility-cabinet.{index}.lod0",
        )
    for index in range(5):
        x = 11.1 + index * 0.55
        bpy.ops.mesh.primitive_torus_add(
            major_radius=0.37,
            minor_radius=0.035,
            major_segments=28,
            minor_segments=8,
            location=(x, 0.42, 68),
            rotation=(math.pi / 2, 0, 0),
        )
        obj = bpy.context.object
        obj.name = f"BIKE_RACK_{index}"
        obj.data.materials.append(MATERIALS["chrome"])
        move_to(obj, target)
        tag(obj, f"prop.bike-rack.{index}.lod0")
    # Bus shelter.
    rounded_box(
        target,
        "BUS_SHELTER_ROOF",
        (-12.1, 2.35, 118),
        (3.6, 0.18, 1.85),
        MATERIALS["black_metal"],
        bevel=0.08,
        asset_id="prop.bus-shelter.roof",
    )
    for x in (-13.65, -10.55):
        rounded_box(
            target,
            f"BUS_SHELTER_POST_{x}",
            (x, 1.2, 118.65),
            (0.09, 2.4, 0.09),
            MATERIALS["black_metal"],
            bevel=0.025,
            asset_id=f"prop.bus-shelter.post.{x}",
        )
    rounded_box(
        target,
        "BUS_SHELTER_GLASS",
        (-12.1, 1.2, 118.78),
        (3.15, 2.25, 0.06),
        MATERIALS["glass"],
        bevel=0.025,
        asset_id="prop.bus-shelter.glass",
    )


def build_lobby(target: bpy.types.Collection) -> None:
    root = root_empty(target, "HQ_LOBBY_ROOT", "interior.hq-lobby.lod0")
    parts: list[bpy.types.Object] = []
    # Physical envelope, wall panels and ceiling grid.
    parts.extend(
        [
            rounded_box(
                target,
                "LOBBY_FLOOR",
                (0, -0.08, -15),
                (42, 0.16, 30),
                MATERIALS["stone"],
                bevel=0.02,
                asset_id="interior.hq-lobby.floor",
            ),
            rounded_box(
                target,
                "LOBBY_CEILING",
                (0, 9.45, -15),
                (42, 0.16, 30),
                MATERIALS["concrete"],
                bevel=0.02,
                asset_id="interior.hq-lobby.ceiling",
            ),
        ]
    )
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"LOBBY_SIDE_WALL_{side}",
                (side * 20.9, 4.7, -15),
                (0.22, 9.4, 30),
                MATERIALS["plaster"],
                bevel=0.04,
                asset_id=f"interior.hq-lobby.wall.{side}",
            )
        )
    for row in range(5):
        z = -3.2 - row * 5.6
        for col in range(-4, 5):
            parts.append(
                rounded_box(
                    target,
                    f"LOBBY_CEILING_PANEL_{row}_{col}",
                    (col * 4.35, 9.28, z),
                    (4.0, 0.12, 5.15),
                    MATERIALS["concrete"],
                    bevel=0.04,
                    asset_id=f"interior.hq-lobby.ceiling-panel.{row}.{col}",
                )
            )
        parts.append(
            rounded_box(
                target,
                f"LOBBY_LIGHT_{row}",
                (0, 9.16, z),
                (13.5, 0.08, 0.24),
                MATERIALS["white_light"],
                bevel=0.04,
                asset_id=f"interior.hq-lobby.light.{row}",
            )
        )
    # Reception desk with layered stone, timber, hardware, and workstation.
    parts.extend(
        [
            rounded_box(
                target,
                "RECEPTION_DESK_BODY",
                (-6.5, 0.54, -13),
                (6.4, 1.08, 1.5),
                MATERIALS["wood"],
                bevel=0.16,
                asset_id="interior.reception-desk.body",
            ),
            rounded_box(
                target,
                "RECEPTION_DESK_TOP",
                (-6.5, 1.13, -13),
                (6.7, 0.16, 1.75),
                MATERIALS["stone"],
                bevel=0.075,
                asset_id="interior.reception-desk.top",
            ),
            rounded_box(
                target,
                "RECEPTION_DESK_INLAY",
                (-6.5, 0.62, -12.19),
                (5.7, 0.42, 0.06),
                MATERIALS["black_metal"],
                bevel=0.035,
                asset_id="interior.reception-desk.inlay",
            ),
        ]
    )
    for index, x in enumerate((-7.5, -5.5)):
        parts.extend(
            [
                rounded_box(
                    target,
                    f"RECEPTION_MONITOR_{index}",
                    (x, 1.65, -13.35),
                    (0.78, 0.48, 0.08),
                    MATERIALS["screen"],
                    bevel=0.045,
                    asset_id=f"interior.reception.monitor.{index}",
                ),
                rounded_box(
                    target,
                    f"RECEPTION_KEYBOARD_{index}",
                    (x, 1.25, -12.86),
                    (0.62, 0.05, 0.24),
                    MATERIALS["black_metal"],
                    bevel=0.035,
                    asset_id=f"interior.reception.keyboard.{index}",
                ),
            ]
        )
    rounded_box(
        target,
        "RECEPTION_PHONE",
        (-4.2, 1.28, -12.9),
        (0.34, 0.12, 0.24),
        MATERIALS["black_metal"],
        bevel=0.05,
        asset_id="interior.reception.phone",
    )
    # Visitor seating.
    for index, (x, z) in enumerate(((7.5, -8), (12, -8), (7.5, -15), (12, -15))):
        parts.extend(
            [
                rounded_box(
                    target,
                    f"LOUNGE_SEAT_{index}",
                    (x, 0.46, z),
                    (2.3, 0.48, 1.05),
                    MATERIALS["canvas_blue"],
                    bevel=0.19,
                    asset_id=f"interior.lounge-chair.seat.{index}",
                ),
                rounded_box(
                    target,
                    f"LOUNGE_BACK_{index}",
                    (x, 0.92, z + 0.46),
                    (2.3, 0.82, 0.18),
                    MATERIALS["canvas_blue"],
                    bevel=0.13,
                    asset_id=f"interior.lounge-chair.back.{index}",
                ),
            ]
        )
    rounded_box(
        target,
        "LOUNGE_TABLE",
        (9.75, 0.38, -11.5),
        (3.1, 0.16, 1.35),
        MATERIALS["wood"],
        bevel=0.12,
        asset_id="interior.lounge-table",
    )
    # Security gates and elevator bank.
    for index, x in enumerate((-2.2, 0, 2.2)):
        parts.extend(
            [
                rounded_box(
                    target,
                    f"ACCESS_GATE_{index}",
                    (x, 0.54, -22.4),
                    (0.34, 1.08, 1.35),
                    MATERIALS["black_metal"],
                    bevel=0.07,
                    asset_id=f"interior.access-gate.{index}",
                ),
                rounded_box(
                    target,
                    f"ACCESS_GATE_GLASS_{index}",
                    (x + 0.55, 0.72, -22.4),
                    (0.92, 0.68, 0.055),
                    MATERIALS["glass"],
                    bevel=0.025,
                    asset_id=f"interior.access-gate.glass.{index}",
                ),
            ]
        )
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"ELEVATOR_BANK_WALL_{side}",
                (side * 11.55, 4.7, -29.78),
                (18.8, 9.4, 0.32),
                MATERIALS["stone"],
                bevel=0.05,
                asset_id=f"interior.elevator-bank.wall.{side}",
            )
        )
    parts.extend(
        [
            rounded_box(
                target,
                "ELEVATOR_BANK_HEADER",
                (0, 7.6, -29.72),
                (4.6, 3.6, 0.42),
                MATERIALS["stone"],
                bevel=0.07,
                asset_id="interior.elevator-bank.header",
            ),
            rounded_box(
                target,
                "LOBBY_DIRECTORY",
                (13.2, 3.0, -29.45),
                (6.0, 3.5, 0.12),
                MATERIALS["screen"],
                bevel=0.08,
                asset_id="interior.directory-display",
            ),
        ]
    )
    # Planters with sculpted-looking foliage clusters.
    for index, (x, z) in enumerate(((-16.5, -6), (16.5, -6), (-16.5, -24), (16.5, -24))):
        parts.append(
            rounded_box(
                target,
                f"LOBBY_PLANTER_{index}",
                (x, 0.42, z),
                (1.2, 0.84, 1.2),
                MATERIALS["stone"],
                bevel=0.13,
                asset_id=f"interior.planter.{index}",
            )
        )
        for leaf in range(7):
            angle = leaf * math.tau / 7
            leaf_obj = cylinder(
                target,
                f"LOBBY_PLANT_{index}_{leaf}",
                (
                    x + math.cos(angle) * 0.25,
                    1.1 + (leaf % 3) * 0.18,
                    z + math.sin(angle) * 0.25,
                ),
                0.075,
                1.0 + (leaf % 2) * 0.32,
                MATERIALS["green"],
                vertices=12,
                rotation=(math.sin(angle) * 0.35, 0, -math.cos(angle) * 0.35),
                asset_id=f"interior.plant.{index}.{leaf}",
            )
            parts.append(leaf_obj)
    parent_objects(root, parts)


def build_floor45(target: bpy.types.Collection) -> None:
    root = root_empty(target, "FLOOR45_ROOT", "interior.floor45.lod0")
    parts: list[bpy.types.Object] = [
        rounded_box(
            target,
            "F45_FLOOR",
            (0, 179.92, -13),
            (32, 0.16, 34),
            MATERIALS["stone"],
            bevel=0.02,
            asset_id="interior.floor45.floor",
        ),
        rounded_box(
            target,
            "F45_CEILING",
            (0, 184.55, -13),
            (32, 0.14, 34),
            MATERIALS["concrete"],
            bevel=0.02,
            asset_id="interior.floor45.ceiling",
        ),
    ]
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"F45_GLASS_WALL_{side}",
                (side * 15.9, 182.3, -13),
                (0.12, 4.6, 34),
                MATERIALS["glass"],
                bevel=0.025,
                asset_id=f"interior.floor45.curtain-wall.{side}",
            )
        )
        for z in range(-28, 4, 3):
            parts.append(
                rounded_box(
                    target,
                    f"F45_MULLION_{side}_{z}",
                    (side * 15.82, 182.3, z),
                    (0.18, 4.6, 0.12),
                    MATERIALS["black_metal"],
                    bevel=0.025,
                    asset_id=f"interior.floor45.mullion.{side}.{z}",
                )
            )
    office_slots = [
        (-10, -6, 1),
        (-10, -14, 1),
        (-10, -22, 1),
        (10, -6, -1),
        (10, -14, -1),
        (10, -22, -1),
    ]
    for index, (x, z, side) in enumerate(office_slots):
        back_x = x - side * 4.2
        front_x = x + side * 4.2
        parts.extend(
            [
                rounded_box(
                    target,
                    f"OFFICE_BACK_{index}",
                    (back_x, 181.6, z),
                    (0.2, 3.2, 6.4),
                    MATERIALS["plaster"],
                    bevel=0.035,
                    asset_id=f"interior.office.{index}.back-wall",
                ),
                rounded_box(
                    target,
                    f"OFFICE_GLASS_{index}",
                    (front_x, 181.6, z),
                    (0.06, 3.2, 4.8),
                    MATERIALS["glass"],
                    bevel=0.02,
                    asset_id=f"interior.office.{index}.glass-front",
                ),
                rounded_box(
                    target,
                    f"OFFICE_DESK_{index}",
                    (x + side * 1.6, 180.58, z),
                    (2.7, 0.14, 1.25),
                    MATERIALS["wood"],
                    bevel=0.08,
                    asset_id=f"interior.office.{index}.desk",
                ),
                rounded_box(
                    target,
                    f"OFFICE_MONITOR_{index}",
                    (x + side * 1.6, 181.2, z),
                    (0.1, 0.62, 0.92),
                    MATERIALS["screen"],
                    bevel=0.045,
                    asset_id=f"interior.office.{index}.monitor",
                ),
            ]
        )
        for dz in (-3.2, 3.2):
            parts.append(
                rounded_box(
                    target,
                    f"OFFICE_PARTITION_{index}_{dz}",
                    (x, 181.6, z + dz),
                    (8.4, 3.2, 0.16),
                    MATERIALS["black_metal"],
                    bevel=0.035,
                    asset_id=f"interior.office.{index}.partition.{dz}",
                )
            )
    for row, z in enumerate((-3, -9, -15, -21, -27)):
        parts.append(
            rounded_box(
                target,
                f"F45_LIGHT_{row}",
                (0, 184.37, z),
                (4.5, 0.08, 0.24),
                MATERIALS["white_light"],
                bevel=0.035,
                asset_id=f"interior.floor45.light.{row}",
            )
        )
    parent_objects(root, parts)


def build_door_leaf(target: bpy.types.Collection) -> None:
    root = root_empty(target, "AUTOMATIC_DOOR_LEAF", "prop.automatic-door-leaf.lod0")
    parts = [
        rounded_box(
            target,
            "DOOR_GLASS",
            (0, 2.05, 0),
            (3.15, 4.05, 0.075),
            MATERIALS["glass"],
            bevel=0.025,
            asset_id="prop.automatic-door-leaf.glass",
        )
    ]
    for y in (0.04, 4.06):
        parts.append(
            rounded_box(
                target,
                f"DOOR_RAIL_{y}",
                (0, y, 0),
                (3.35, 0.12, 0.16),
                MATERIALS["black_metal"],
                bevel=0.035,
                asset_id=f"prop.automatic-door-leaf.rail.{y}",
            )
        )
    for x in (-1.61, 1.61):
        parts.append(
            rounded_box(
                target,
                f"DOOR_STILE_{x}",
                (x, 2.05, 0),
                (0.13, 4.1, 0.16),
                MATERIALS["black_metal"],
                bevel=0.035,
                asset_id=f"prop.automatic-door-leaf.stile.{x}",
            )
        )
    parts.append(
        rounded_box(
            target,
            "DOOR_HANDLE",
            (1.18, 1.15, 0.12),
            (0.07, 0.62, 0.08),
            MATERIALS["chrome"],
            bevel=0.03,
            asset_id="prop.automatic-door-leaf.handle",
        )
    )
    parent_objects(root, parts)


def build_vehicle(
    target: bpy.types.Collection,
    family: str,
    length: float,
    width: float,
    height: float,
    paint: tuple[float, float, float, float],
    roof_scale: float,
) -> None:
    paint_mat = material(f"MAT_CarPaint_{family}", paint, 0.16, 0.78)
    root = root_empty(target, f"VEHICLE_{family}", f"vehicle.{family}.lod0")
    parts: list[bpy.types.Object] = []
    body = rounded_box(
        target,
        f"{family}_BODY",
        (0, 0.58, 0),
        (width, 0.58, length),
        paint_mat,
        bevel=0.18,
        asset_id=f"vehicle.{family}.body",
    )
    hood = rounded_box(
        target,
        f"{family}_HOOD",
        (0, 0.82, length * 0.31),
        (width * 0.9, 0.22, length * 0.26),
        paint_mat,
        bevel=0.11,
        asset_id=f"vehicle.{family}.hood",
    )
    cabin = rounded_box(
        target,
        f"{family}_CABIN",
        (0, 1.05, -length * 0.05),
        (width * 0.84, height * roof_scale, length * 0.46),
        MATERIALS["glass"],
        bevel=0.22,
        asset_id=f"vehicle.{family}.cabin",
    )
    roof_y = 1.05 + (height * roof_scale) * 0.5
    roof = rounded_box(
        target,
        f"{family}_ROOF",
        (0, roof_y, -length * 0.05),
        (width * 0.76, 0.075, length * 0.33),
        paint_mat,
        bevel=0.035,
        asset_id=f"vehicle.{family}.roof",
    )
    parts.extend((body, hood, cabin, roof))
    # Windshield pillars, panel gaps, grille, lights, mirrors, handles.
    for side in (-1, 1):
        parts.append(
            rounded_box(
                target,
                f"{family}_BELTLINE_{side}",
                (side * width * 0.43, 0.94, -length * 0.05),
                (0.055, 0.07, length * 0.43),
                MATERIALS["black_metal"],
                bevel=0.018,
                asset_id=f"vehicle.{family}.beltline.{side}",
            )
        )
        for pillar, z in (("A", length * 0.17), ("C", -length * 0.25)):
            parts.append(
                rounded_box(
                    target,
                    f"{family}_{pillar}_PILLAR_{side}",
                    (side * width * 0.43, 1.18, z),
                    (0.07, height * roof_scale * 0.53, 0.085),
                    paint_mat,
                    bevel=0.022,
                    asset_id=f"vehicle.{family}.pillar.{pillar}.{side}",
                )
            )
        parts.append(
            rounded_box(
                target,
                f"{family}_ROCKER_{side}",
                (side * width * 0.49, 0.42, 0),
                (0.06, 0.23, length * 0.82),
                MATERIALS["black_metal"],
                bevel=0.025,
                asset_id=f"vehicle.{family}.rocker.{side}",
            )
        )
    for end, z in (("front", length * 0.19), ("rear", -length * 0.27)):
        parts.append(
            rounded_box(
                target,
                f"{family}_WINDSHIELD_HEADER_{end}",
                (0, roof_y - 0.06, z),
                (width * 0.76, 0.065, 0.06),
                paint_mat,
                bevel=0.022,
                asset_id=f"vehicle.{family}.windshield-header.{end}",
            )
        )
        parts.append(
            rounded_box(
                target,
                f"{family}_MIRROR_{side}",
                (side * width * 0.58, 1.14, length * 0.08),
                (0.22, 0.12, 0.28),
                paint_mat,
                bevel=0.07,
                asset_id=f"vehicle.{family}.mirror.{side}",
            )
        )
        for z in (-length * 0.18, length * 0.16):
            parts.append(
                rounded_box(
                    target,
                    f"{family}_HANDLE_{side}_{z}",
                    (side * width * 0.505, 0.9, z),
                    (0.045, 0.055, 0.24),
                    MATERIALS["chrome"],
                    bevel=0.02,
                    asset_id=f"vehicle.{family}.door-handle.{side}.{z}",
                )
            )
    parts.extend(
        [
            rounded_box(
                target,
                f"{family}_GRILLE",
                (0, 0.56, length * 0.505),
                (width * 0.58, 0.28, 0.055),
                MATERIALS["black_metal"],
                bevel=0.035,
                asset_id=f"vehicle.{family}.grille",
            ),
            rounded_box(
                target,
                f"{family}_REAR_BUMPER",
                (0, 0.48, -length * 0.505),
                (width * 0.76, 0.2, 0.08),
                MATERIALS["black_metal"],
                bevel=0.045,
                asset_id=f"vehicle.{family}.rear-bumper",
            ),
        ]
    )
    for side in (-1, 1):
        for z, light_mat, label in (
            (length * 0.51, MATERIALS["white_light"], "headlight"),
            (-length * 0.51, MATERIALS["red_light"], "taillight"),
        ):
            parts.append(
                rounded_box(
                    target,
                    f"{family}_{label}_{side}",
                    (side * width * 0.34, 0.72, z),
                    (0.38, 0.16, 0.06),
                    light_mat,
                    bevel=0.055,
                    asset_id=f"vehicle.{family}.{label}.{side}",
                )
            )
    # Interior silhouette visible through glass.
    for z in (-length * 0.08, length * 0.09):
        for side in (-1, 1):
            parts.append(
                rounded_box(
                    target,
                    f"{family}_SEAT_{side}_{z}",
                    (side * width * 0.21, 0.93, z),
                    (width * 0.3, 0.6, 0.42),
                    MATERIALS["black_metal"],
                    bevel=0.12,
                    asset_id=f"vehicle.{family}.seat.{side}.{z}",
                )
            )
    # Wheels point along X so local Z remains vehicle forward.
    for side in (-1, 1):
        for axle, z in (("front", length * 0.31), ("rear", -length * 0.31)):
            wheel = cylinder(
                target,
                f"wheel_{axle}_{'L' if side < 0 else 'R'}",
                (side * width * 0.53, 0.42, z),
                0.36 if family != "delivery-van" else 0.39,
                0.24,
                MATERIALS["rubber"],
                vertices=32,
                rotation=(0, math.pi / 2, 0),
                asset_id=f"vehicle.{family}.wheel.{axle}.{side}",
            )
            hub = cylinder(
                target,
                f"hub_{axle}_{'L' if side < 0 else 'R'}",
                (side * width * 0.66, 0.42, z),
                0.22,
                0.035,
                MATERIALS["chrome"],
                vertices=28,
                rotation=(0, math.pi / 2, 0),
                asset_id=f"vehicle.{family}.hub.{axle}.{side}",
            )
            wheel.parent = root
            hub.parent = wheel
            parts.append(wheel)
    parent_objects(root, [part for part in parts if part.parent is None])


def objects_recursive(target: bpy.types.Collection) -> list[bpy.types.Object]:
    values = list(target.objects)
    for child in target.children:
        values.extend(objects_recursive(child))
    return values


def orient_collection_for_blender_and_gltf(target: bpy.types.Collection) -> None:
    """Convert the authored game-space axes into Blender's native Z-up space.

    The builders deliberately use Three.js coordinates (X right, Y up, Z
    forward) so dimensions remain directly comparable with gameplay layout
    data. Blender uses Z up. A single editable root preserves that authoring
    convention while making the .blend viewport and the exported glTF both
    physically upright.
    """
    root = bpy.data.objects.new(f"{target.name}_AXIS_ROOT", None)
    root.rotation_euler.x = math.pi / 2
    target.objects.link(root)
    tag(root, f"axis-root.{target.name}", role="transform")
    for obj in list(target.objects):
        if obj is root or obj.parent is not None:
            continue
        obj.parent = root


def export_collection(target: bpy.types.Collection, filepath: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects_recursive(target):
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(
        (obj for obj in target.objects if obj.type in {"MESH", "EMPTY"}),
        None,
    )
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=False,
        collection=target.name,
        export_apply=True,
        export_extras=True,
        export_materials="EXPORT",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )


scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100

exterior = collection("PRODUCTION_ExteriorHeroDistrict")
lobby = collection("PRODUCTION_HQLobby")
floor45 = collection("PRODUCTION_Floor45")
door = collection("PRODUCTION_AutomaticDoor")
vehicle_collections = {
    family: collection(f"PRODUCTION_Vehicle_{family}")
    for family in ("premium-sedan", "suv-crossover", "compact-city", "delivery-van")
}

build_ground(exterior)
for building in BUILDINGS:
    build_storefront(exterior, *building)
build_hq(exterior)
build_market(exterior)
build_street_props(exterior)
build_lobby(lobby)
build_floor45(floor45)
build_door_leaf(door)
build_vehicle(
    vehicle_collections["premium-sedan"],
    "premium-sedan",
    4.75,
    1.88,
    1.43,
    (0.035, 0.055, 0.09, 1),
    0.62,
)
build_vehicle(
    vehicle_collections["suv-crossover"],
    "suv-crossover",
    4.62,
    1.96,
    1.72,
    (0.12, 0.12, 0.13, 1),
    0.7,
)
build_vehicle(
    vehicle_collections["compact-city"],
    "compact-city",
    3.92,
    1.78,
    1.52,
    (0.36, 0.065, 0.025, 1),
    0.68,
)
build_vehicle(
    vehicle_collections["delivery-van"],
    "delivery-van",
    5.35,
    2.04,
    2.34,
    (0.19, 0.21, 0.22, 1),
    0.82,
)

# Store and export every collection upright. Blender's glTF exporter converts
# this native Z-up scene to Three.js Y-up coordinates.
for target in [exterior, lobby, floor45, door, *vehicle_collections.values()]:
    orient_collection_for_blender_and_gltf(target)

# Keep every collection editable in the source file. Runtime exports are made
# one collection at a time to preserve stable zone-streaming boundaries.
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
export_collection(exterior, RUNTIME / "architecture" / "hero-district.glb")
export_collection(lobby, RUNTIME / "interiors" / "hq-lobby.glb")
export_collection(floor45, RUNTIME / "interiors" / "floor45.glb")
export_collection(door, RUNTIME / "props" / "automatic-door-leaf.glb")
for family, target in vehicle_collections.items():
    export_collection(target, RUNTIME / "vehicles" / f"{family}.glb")

mesh_objects = [obj for obj in bpy.data.objects if obj.type == "MESH"]
triangle_count = 0
for obj in mesh_objects:
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    triangle_count += len(mesh.loop_triangles)
    evaluated.to_mesh_clear()

result = {
    "blend_file": str(BLEND_PATH),
    "runtime_root": str(RUNTIME),
    "collections": 8,
    "mesh_objects": len(mesh_objects),
    "materials": len(bpy.data.materials),
    "triangles": triangle_count,
    "exports": [
        "architecture/hero-district.glb",
        "interiors/hq-lobby.glb",
        "interiors/floor45.glb",
        "props/automatic-door-leaf.glb",
        "vehicles/premium-sedan.glb",
        "vehicles/suv-crossover.glb",
        "vehicles/compact-city.glb",
        "vehicles/delivery-van.glb",
    ],
}
