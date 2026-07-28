"""Add the authored headquarters plaza to the current production source/export."""

from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
BLEND_PATH = ROOT / "SourceAssets/Models/Environment/Working/Shenzhen_City_Production_Pass_02.blend"
OUTPUT = ROOT / "public/assets/production/architecture/hero-district.glb"
target = max(
    (
        value for value in bpy.data.collections
        if value.name.startswith("PRODUCTION_ExteriorHeroDistrict")
    ),
    key=lambda value: len(value.all_objects),
)
axis_root = next(
    obj for obj in target.objects
    if obj.type == "EMPTY" and obj.name.endswith("_AXIS_ROOT")
)


def material(name: str) -> bpy.types.Material:
    result = bpy.data.materials.get(name)
    if result is None:
        raise RuntimeError(f"Missing production material {name}")
    return result


def remove(name: str) -> None:
    obj = bpy.data.objects.get(name)
    if obj is not None:
        bpy.data.objects.remove(obj, do_unlink=True)


def box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material_name: str,
    asset_id: str,
    bevel: float,
) -> None:
    remove(name)
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Production_Bevel", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    obj.data.materials.append(material(material_name))
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    target.objects.link(obj)
    obj["asset_id"] = asset_id
    obj["production_role"] = "render"
    obj["source"] = "project-authored"
    obj["license"] = "Project-owned"
    obj.parent = axis_root


box(
    "HQ_PLAZA_PAVING",
    (0, -0.045, 17),
    (56, 0.16, 34),
    "MAT_Sidewalk",
    "plaza.hq.paving.lod0",
    0.025,
)
box(
    "HQ_PLAZA_APPROACH",
    (0, 0.045, 17),
    (10.5, 0.08, 34),
    "MAT_Stone",
    "plaza.hq.approach.lod0",
    0.02,
)
for index in range(7):
    box(
        f"HQ_PLAZA_JOINT_{index}",
        (-24 + index * 8, 0.045, 17),
        (0.035, 0.012, 33.5),
        "MAT_BlackMetal",
        f"plaza.hq.expansion-joint.{index}",
        0.002,
    )

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
bpy.ops.object.select_all(action="DESELECT")
for obj in target.all_objects:
    if obj is None:
        continue
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.hide_render = False
    obj.select_set(True)
bpy.context.view_layer.objects.active = axis_root
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
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

result = {"blend_file": str(BLEND_PATH), "runtime": str(OUTPUT), "added_meshes": 9}
