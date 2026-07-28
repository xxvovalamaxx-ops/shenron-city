"""Author the Production Pass 02 elevator in the open Blender source project."""

from __future__ import annotations

import math
from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
BLEND_PATH = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Working"
    / "Shenzhen_City_Production_Pass_02.blend"
)
RUNTIME = ROOT / "public" / "assets" / "production" / "interiors"
RUNTIME.mkdir(parents=True, exist_ok=True)


def remove_collection(name: str) -> None:
    target = bpy.data.collections.get(name)
    if target is None:
        return
    for obj in list(target.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(target)


def new_collection(name: str) -> bpy.types.Collection:
    remove_collection(name)
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def move_to(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)


def tag(obj: bpy.types.Object, asset_id: str, role: str = "render") -> None:
    obj["asset_id"] = asset_id
    obj["production_role"] = role
    obj["source"] = "project-authored"
    obj["license"] = "Project-owned"


def mat(name: str) -> bpy.types.Material:
    value = bpy.data.materials.get(name)
    if value is None:
        raise RuntimeError(f"Required production material is missing: {name}")
    return value


def box(
    target: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: str,
    *,
    bevel: float = 0.035,
    asset_id: str | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Production_Bevel", "BEVEL")
        modifier.width = min(bevel, min(dimensions) * 0.2)
        modifier.segments = 3
    obj.data.materials.append(mat(material))
    move_to(obj, target)
    tag(obj, asset_id or name)
    return obj


def cylinder(
    target: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: str,
    *,
    rotation: tuple[float, float, float] = (0, 0, 0),
    vertices: int = 28,
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
    obj.data.materials.append(mat(material))
    move_to(obj, target)
    tag(obj, asset_id or name)
    return obj


def orient(target: bpy.types.Collection) -> None:
    root = bpy.data.objects.new(f"{target.name}_AXIS_ROOT", None)
    root.rotation_euler.x = math.pi / 2
    target.objects.link(root)
    tag(root, f"axis-root.{target.name}", "transform")
    for obj in list(target.objects):
        if obj is not root and obj.parent is None:
            obj.parent = root


def export(target: bpy.types.Collection, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in target.all_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(
        (obj for obj in target.objects if obj.type in {"MESH", "EMPTY"}),
        None,
    )
    bpy.ops.export_scene.gltf(
        filepath=str(path),
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


static = new_collection("PRODUCTION_ElevatorStatic")
car = new_collection("PRODUCTION_ElevatorCar")

half_width = 2.1
door_z = -30.0
back_z = -35.0
car_depth = 4.4
car_height = 3.4
car_z = door_z - car_depth / 2

# Concrete fire-rated shaft with metal guide structure.
box(static, "ELEVATOR_SHAFT_BACK", (0, 92, back_z), (5.6, 190, 0.32), "MAT_Concrete",
    bevel=0.02, asset_id="elevator.shaft.back")
for side in (-1, 1):
    box(
        static,
        f"ELEVATOR_SHAFT_SIDE_{side}",
        (side * 2.72, 92, (door_z + back_z) / 2),
        (0.32, 190, abs(back_z - door_z)),
        "MAT_Concrete",
        bevel=0.02,
        asset_id=f"elevator.shaft.side.{side}",
    )
    box(
        static,
        f"ELEVATOR_GUIDE_RAIL_{side}",
        (side * 1.7, 92, back_z + 0.22),
        (0.14, 190, 0.18),
        "MAT_Chrome",
        bevel=0.018,
        asset_id=f"elevator.guide-rail.{side}",
    )
for y in range(2, 188, 8):
    box(
        static,
        f"ELEVATOR_SHAFT_RIB_{y}",
        (0, y, back_z + 0.19),
        (5.0, 0.16, 0.18),
        "MAT_BlackMetal",
        bevel=0.02,
        asset_id=f"elevator.shaft-rib.{y}",
    )

# Portal cladding, reveal, transom and call station.
for side in (-1, 1):
    box(
        static,
        f"ELEVATOR_PORTAL_JAMB_{side}",
        (side * (half_width + 0.23), 1.9, door_z + 0.28),
        (0.46, car_height + 0.4, 0.5),
        "MAT_Chrome",
        bevel=0.045,
        asset_id=f"elevator.portal.jamb.{side}",
    )
box(
    static,
    "ELEVATOR_PORTAL_HEADER",
    (0, car_height + 0.4, door_z + 0.28),
    (half_width * 2 + 0.92, 0.42, 0.5),
    "MAT_Chrome",
    bevel=0.045,
    asset_id="elevator.portal.header",
)
box(
    static,
    "ELEVATOR_PORTAL_REVEAL",
    (0, car_height + 0.64, door_z + 0.35),
    (half_width * 2 + 0.5, 0.055, 0.055),
    "MAT_Screen",
    bevel=0.012,
    asset_id="elevator.portal.reveal",
)
box(
    static,
    "ELEVATOR_CALL_PLATE",
    (half_width + 0.63, 1.28, door_z + 0.55),
    (0.32, 0.68, 0.055),
    "MAT_BlackMetal",
    bevel=0.04,
    asset_id="elevator.call.plate",
)
cylinder(
    static,
    "ELEVATOR_CALL_BUTTON",
    (half_width + 0.63, 1.42, door_z + 0.59),
    0.062,
    0.035,
    "MAT_Screen",
    rotation=(math.pi / 2, 0, 0),
    asset_id="elevator.call.button",
)

# Car: layered floor/ceiling, segmented wall panels, rear mirror band, handrails.
box(car, "ELEVATOR_CAR_FLOOR", (0, -0.08, car_z), (4.2, 0.16, car_depth),
    "MAT_Stone", bevel=0.03, asset_id="elevator.car.floor")
box(car, "ELEVATOR_CAR_CEILING", (0, car_height + 0.08, car_z), (4.2, 0.16, car_depth),
    "MAT_BlackMetal", bevel=0.03, asset_id="elevator.car.ceiling")
for side in (-1, 1):
    for row in range(3):
        z = car_z - car_depth / 2 + 0.75 + row * 1.45
        box(
            car,
            f"ELEVATOR_CAR_SIDE_{side}_{row}",
            (side * half_width, car_height / 2, z),
            (0.12, car_height, 1.32),
            "MAT_Metal",
            bevel=0.025,
            asset_id=f"elevator.car.side.{side}.{row}",
        )
    cylinder(
        car,
        f"ELEVATOR_HANDRAIL_{side}",
        (side * 1.94, 1.04, car_z),
        0.035,
        car_depth * 0.72,
        "MAT_Chrome",
        rotation=(math.pi / 2, 0, 0),
        asset_id=f"elevator.car.handrail.{side}",
    )
for column in range(3):
    x = (column - 1) * 1.37
    box(
        car,
        f"ELEVATOR_CAR_BACK_{column}",
        (x, car_height / 2, car_z - car_depth / 2),
        (1.26, car_height, 0.12),
        "MAT_Metal" if column != 1 else "MAT_Glass",
        bevel=0.025,
        asset_id=f"elevator.car.back.{column}",
    )
box(
    car,
    "ELEVATOR_CEILING_LIGHT",
    (0, car_height - 0.04, car_z),
    (2.9, 0.035, 0.34),
    "MAT_WhiteLight",
    bevel=0.025,
    asset_id="elevator.car.ceiling-light",
)
box(
    car,
    "ELEVATOR_FLOOR_REVEAL",
    (0, 0.03, car_z),
    (3.9, 0.025, 0.065),
    "MAT_Screen",
    bevel=0.008,
    asset_id="elevator.car.floor-reveal",
)

# Control panel and two physical buttons at the gameplay anchor.
panel_x = half_width - 0.14
panel_y = 1.25
panel_z = door_z - car_depth / 2 + 0.9
box(
    car,
    "ELEVATOR_CONTROL_PANEL",
    (panel_x, panel_y, panel_z),
    (0.065, 1.12, 0.52),
    "MAT_BlackMetal",
    bevel=0.045,
    asset_id="elevator.car.control-panel",
)
for index, y in enumerate((panel_y + 0.25, panel_y - 0.25)):
    cylinder(
        car,
        f"ELEVATOR_CONTROL_BUTTON_{index}",
        (panel_x - 0.045, y, panel_z),
        0.105,
        0.04,
        "MAT_Screen",
        rotation=(0, math.pi / 2, 0),
        asset_id=f"elevator.car.control-button.{index}",
    )

orient(static)
orient(car)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
export(static, RUNTIME / "elevator-static.glb")
export(car, RUNTIME / "elevator-car.glb")

result = {
    "blend_file": str(BLEND_PATH),
    "exports": [
        str(RUNTIME / "elevator-static.glb"),
        str(RUNTIME / "elevator-car.glb"),
    ],
    "static_meshes": len([obj for obj in static.all_objects if obj.type == "MESH"]),
    "car_meshes": len([obj for obj in car.all_objects if obj.type == "MESH"]),
}
