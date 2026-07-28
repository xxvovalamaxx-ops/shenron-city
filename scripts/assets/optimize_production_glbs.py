"""Batch static Blender exports by material for browser draw-call budgets.

The editable source collections remain untouched. Evaluated copies (including
bevel modifiers and the game-to-Blender axis root) are baked into a temporary
collection, joined only when their material-slot signatures match, exported,
and removed again. Vehicles and door leaves retain their authored node
hierarchies because gameplay animates those nodes.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
RUNTIME = ROOT / "public" / "assets" / "production"

EXPORTS = {
    "PRODUCTION_ExteriorHeroDistrict": RUNTIME
    / "architecture"
    / "hero-district.glb",
    "PRODUCTION_HQLobby": RUNTIME / "interiors" / "hq-lobby.glb",
    "PRODUCTION_Floor45": RUNTIME / "interiors" / "floor45.glb",
    "PRODUCTION_ElevatorStatic": RUNTIME / "interiors" / "elevator-static.glb",
    "PRODUCTION_ElevatorCar": RUNTIME / "interiors" / "elevator-car.glb",
}

CANONICAL_COLLECTIONS = [
    *EXPORTS,
    "PRODUCTION_AutomaticDoor",
    "PRODUCTION_Vehicle_premium-sedan",
    "PRODUCTION_Vehicle_suv-crossover",
    "PRODUCTION_Vehicle_compact-city",
    "PRODUCTION_Vehicle_delivery-van",
]


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "unassigned"


def clear_collection(target: bpy.types.Collection) -> None:
    for obj in list(target.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(target)


def resolve_source_collection(prefix: str) -> bpy.types.Collection:
    matches = [
        value
        for value in bpy.data.collections
        if value.name == prefix or value.name.startswith(f"{prefix}.")
    ]
    if not matches:
        raise RuntimeError(f"Missing source collection: {prefix}")
    source = max(matches, key=lambda value: len(value.all_objects))
    if not source.all_objects:
        raise RuntimeError(f"Source collection contains no objects: {source.name}")
    for candidate in matches:
        if candidate is not source and not candidate.all_objects:
            clear_collection(candidate)
    source.name = prefix
    return source


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
    clone = bpy.data.objects.new(f"RUNTIME_{source.name}", mesh)
    clone.matrix_world = source.matrix_world.copy()
    clone["source_asset_id"] = source.get("asset_id", source.name)
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


def batch_collection(
    source: bpy.types.Collection,
) -> tuple[bpy.types.Collection, dict[str, int]]:
    temp_name = f"RUNTIME_BATCH_{source.name}"
    old = bpy.data.collections.get(temp_name)
    if old is not None:
        clear_collection(old)

    target = bpy.data.collections.new(temp_name)
    bpy.context.scene.collection.children.link(target)
    depsgraph = bpy.context.evaluated_depsgraph_get()

    copies = [
        evaluated_copy(obj, target, depsgraph)
        for obj in source.all_objects
        if obj.type == "MESH"
    ]
    for obj in copies:
        apply_world_transform(obj)

    grouped: dict[tuple[str, ...], list[bpy.types.Object]] = defaultdict(list)
    for obj in copies:
        grouped[material_signature(obj)].append(obj)

    source_count = len(copies)
    for index, (signature, objects) in enumerate(sorted(grouped.items())):
        source_asset_ids = [
            obj.get("source_asset_id", obj.name) for obj in objects
        ]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        label = safe_name("-".join(signature))
        active.name = f"BATCH_{index:02d}_{label}"
        active["asset_id"] = f"runtime-batch.{safe_name(source.name)}.{index:02d}"
        active["source_mesh_count"] = len(objects)
        active["source_asset_ids"] = json.dumps(source_asset_ids)
        active["production_role"] = "render"
        active["source"] = "project-authored"
        active["license"] = "Project-owned"
        active.select_set(False)

    return target, {
        "sourceMeshes": source_count,
        "runtimeBatches": len(grouped),
    }


def export_collection(target: bpy.types.Collection, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in target.all_objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(target.objects), None)
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


sources = {
    prefix: resolve_source_collection(prefix) for prefix in CANONICAL_COLLECTIONS
}

report: dict[str, dict[str, int | str]] = {}
for collection_name, output in EXPORTS.items():
    source_collection = sources[collection_name]
    batch, counts = batch_collection(source_collection)
    export_collection(batch, output)
    report[collection_name] = {
        **counts,
        "output": str(output.relative_to(ROOT)).replace("\\", "/"),
        "bytes": output.stat().st_size,
    }
    clear_collection(batch)

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print(json.dumps(report, indent=2))
