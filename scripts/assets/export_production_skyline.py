"""Export the editable Production Pass 02 skyline into three runtime LODs.

The open `.blend` remains the source of truth. Evaluated copies include bevel
and axis-root transforms, are joined by material for stable browser draw-call
budgets, and are removed after export.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
RUNTIME = ROOT / "public" / "assets" / "production" / "architecture"
EXPORTS = {
    "PRODUCTION_DistantSkyline_LOD0": RUNTIME / "distant-skyline-lod0.glb",
    "PRODUCTION_DistantSkyline_LOD1": RUNTIME / "distant-skyline-lod1.glb",
    "PRODUCTION_DistantSkyline_LOD2": RUNTIME / "distant-skyline-lod2.glb",
}


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", value).strip("-") or "unassigned"


def remove_collection(target: bpy.types.Collection) -> None:
    for obj in list(target.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(target)


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


def batch_collection(
    source: bpy.types.Collection,
    lod: int,
) -> tuple[bpy.types.Collection, dict[str, int]]:
    temp_name = f"RUNTIME_BATCH_DistantSkyline_LOD{lod}"
    old = bpy.data.collections.get(temp_name)
    if old is not None:
        remove_collection(old)

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

    grouped: dict[str, list[bpy.types.Object]] = defaultdict(list)
    for obj in copies:
        name = obj.material_slots[0].material.name if obj.material_slots else "__NO_MATERIAL__"
        grouped[name].append(obj)

    for index, (material_name, objects) in enumerate(sorted(grouped.items())):
        source_asset_ids = [obj.get("source_asset_id", obj.name) for obj in objects]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        active = objects[0]
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        active.name = (
            f"SKYLINE_LOD{lod}_BATCH_{index:02d}_{safe_name(material_name)}"
        )
        active["asset_id"] = f"architecture.skyline.lod{lod}.batch.{index:02d}"
        active["source_mesh_count"] = len(objects)
        active["source_asset_ids"] = json.dumps(source_asset_ids)
        active["production_role"] = "render"
        active["source"] = "project-authored"
        active["license"] = "Project-owned"
        active.select_set(False)

    return target, {
        "sourceMeshes": len(copies),
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


report: dict[str, dict[str, int | str]] = {}
for lod, (source_name, output) in enumerate(EXPORTS.items()):
    source = bpy.data.collections.get(source_name)
    if source is None:
        raise RuntimeError(f"Missing editable skyline collection: {source_name}")
    batch, counts = batch_collection(source, lod)
    export_collection(batch, output)
    report[f"lod{lod}"] = {
        **counts,
        "output": str(output.relative_to(ROOT)).replace("\\", "/"),
        "bytes": output.stat().st_size,
    }
    remove_collection(batch)

print(json.dumps(report, indent=2))
