"""Export a tiny geometry-only template pack from the Blender meadow.

The complete authoring scene contains hundreds of thousands of instances and
must never be shipped to the browser. This exporter keeps one normalized LOD1
mesh for each runtime plant role; Three.js supplies the pinned WebP materials
and the existing deterministic instance transforms.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(SCRIPT_DIR))
from create_aaa_meadow import ASSET_FILES, append_asset_variations, clear_scene  # noqa: E402

ROLE_SOURCES = (
    ("MeadowGrassFine", "grass_c"),
    ("MeadowGrassTall", "grass_b"),
    ("MeadowFern", "fern"),
    ("MeadowWeed", "weed"),
)


def output_path() -> Path:
    try:
        separator = sys.argv.index("--")
        arguments = sys.argv[separator + 1 :]
    except ValueError:
        arguments = []
    for index, argument in enumerate(arguments):
        if argument == "--output-path":
            return Path(arguments[index + 1]).resolve()
    raise ValueError("--output-path is required")


def first_mesh(asset_key: str) -> bpy.types.Object:
    return append_asset_variations(
        asset_key,
        ASSET_FILES[asset_key],
        maximum=1,
        lod=1,
    )[0]


def normalized_copy(source: bpy.types.Object, name: str) -> bpy.types.Object:
    mesh = source.data.copy()
    result = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(result)
    mesh.materials.clear()

    coordinates = [vertex.co.copy() for vertex in mesh.vertices]
    if not coordinates:
        raise RuntimeError(f"{source.name} has no vertices")
    minimum = Vector(
        (
            min(point.x for point in coordinates),
            min(point.y for point in coordinates),
            min(point.z for point in coordinates),
        )
    )
    maximum = Vector(
        (
            max(point.x for point in coordinates),
            max(point.y for point in coordinates),
            max(point.z for point in coordinates),
        )
    )
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError(f"{source.name} has invalid height {height}")
    horizontal_center = Vector(
        ((minimum.x + maximum.x) * 0.5, (minimum.y + maximum.y) * 0.5, minimum.z)
    )
    scale = 1.0 / height
    for vertex in mesh.vertices:
        vertex.co = (vertex.co - horizontal_center) * scale
    mesh.update()
    result["shenron_role"] = name
    result["source_object"] = source.name
    result["source_asset"] = source.name.split("_", 2)[1]
    return result


def main() -> None:
    destination = output_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    clear_scene()

    exported = [
        normalized_copy(first_mesh(asset_key), role)
        for role, asset_key in ROLE_SOURCES
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in exported:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = exported[0]

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_materials="NONE",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_apply=True,
    )
    triangle_count = 0
    for obj in exported:
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    receipt = (
        REPO_ROOT
        / "SourceAssets"
        / "Models"
        / "Environment"
        / "runtime-meadow-geometry-receipt.json"
    )
    receipt.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "license": "CC0-1.0",
                "generator": Path(__file__).relative_to(REPO_ROOT).as_posix(),
                "runtimePath": destination.relative_to(REPO_ROOT).as_posix(),
                "runtimeSha256": digest,
                "bytes": destination.stat().st_size,
                "nodes": [role for role, _ in ROLE_SOURCES],
                "sourceAssets": [asset_key for _, asset_key in ROLE_SOURCES],
                "triangles": triangle_count,
                "materials": 0,
                "textures": 0,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Exported {len(exported)} normalized meadow templates to {destination}")


if __name__ == "__main__":
    main()
