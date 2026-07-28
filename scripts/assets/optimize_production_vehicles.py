"""Batch static vehicle parts while preserving animated wheel pivots."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
RUNTIME = ROOT / "public" / "assets" / "production" / "vehicles"
FAMILIES = (
    "premium-sedan",
    "suv-crossover",
    "compact-city",
    "delivery-van",
)


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "unassigned"


def remove_collection(target: bpy.types.Collection) -> None:
    for obj in list(target.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(target)


def source_collection(prefix: str) -> bpy.types.Collection:
    matches = [
        value
        for value in bpy.data.collections
        if value.name == prefix or value.name.startswith(f"{prefix}.")
    ]
    if not matches:
        raise RuntimeError(f"Missing vehicle source collection: {prefix}")
    result = max(matches, key=lambda value: len(value.all_objects))
    if not result.all_objects:
        raise RuntimeError(f"Empty vehicle source collection: {result.name}")
    return result


def evaluated_copy(
    source: bpy.types.Object,
    target: bpy.types.Collection,
    depsgraph: bpy.types.Depsgraph,
) -> bpy.types.Object:
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    clone = bpy.data.objects.new(source.name, mesh)
    clone.matrix_world = source.matrix_world.copy()
    clone["asset_id"] = source.get("asset_id", source.name)
    clone["production_role"] = "render"
    clone["source"] = "project-authored"
    clone["license"] = "Project-owned"
    target.objects.link(clone)
    return clone


def apply_world_transform(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def material_signature(obj: bpy.types.Object) -> tuple[str, ...]:
    return tuple(
        slot.material.name if slot.material is not None else "__NO_MATERIAL__"
        for slot in obj.material_slots
    )


def export(target: bpy.types.Collection, output: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in target.all_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(target.objects), None)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
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


report: dict[str, dict[str, int]] = {}
depsgraph = bpy.context.evaluated_depsgraph_get()
for family in FAMILIES:
    source = source_collection(f"PRODUCTION_Vehicle_{family}")
    temp_name = f"RUNTIME_BATCH_Vehicle_{family}"
    existing = bpy.data.collections.get(temp_name)
    if existing is not None:
        remove_collection(existing)
    target = bpy.data.collections.new(temp_name)
    bpy.context.scene.collection.children.link(target)

    mesh_sources = [obj for obj in source.all_objects if obj.type == "MESH"]
    dynamic_sources = [
        obj
        for obj in mesh_sources
        if obj.name.startswith("wheel_") or obj.name.startswith("hub_")
    ]
    static_sources = [obj for obj in mesh_sources if obj not in dynamic_sources]

    static_copies = [
        evaluated_copy(obj, target, depsgraph) for obj in static_sources
    ]
    for obj in static_copies:
        apply_world_transform(obj)

    grouped: dict[tuple[str, ...], list[bpy.types.Object]] = defaultdict(list)
    for obj in static_copies:
        grouped[material_signature(obj)].append(obj)

    for index, (signature, objects) in enumerate(sorted(grouped.items())):
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        active.name = f"BATCH_{index:02d}_{safe_name('-'.join(signature))}"
        active["asset_id"] = f"vehicle.{family}.runtime-batch.{index:02d}"
        active["source_mesh_count"] = len(objects)
        active.select_set(False)

    dynamic_copies = {
        obj.name: evaluated_copy(obj, target, depsgraph)
        for obj in dynamic_sources
    }
    for source_obj in dynamic_sources:
        clone = dynamic_copies[source_obj.name]
        parent = source_obj.parent
        if parent is None or not parent.name.startswith("wheel_"):
            continue
        parent_clone = dynamic_copies.get(parent.name)
        if parent_clone is None:
            continue
        world = clone.matrix_world.copy()
        clone.parent = parent_clone
        clone.matrix_world = world

    output = RUNTIME / f"{family}.glb"
    export(target, output)
    report[family] = {
        "sourceMeshes": len(mesh_sources),
        "staticBatches": len(grouped),
        "animatedNodes": len(dynamic_sources),
        "runtimeMeshes": len(grouped) + len(dynamic_sources),
        "bytes": output.stat().st_size,
    }
    remove_collection(target)

print(json.dumps(report, indent=2))
