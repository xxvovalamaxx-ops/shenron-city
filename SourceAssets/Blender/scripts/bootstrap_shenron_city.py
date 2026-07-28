"""Create the Shenron City Blender authoring project.

Designed to be run through the official Blender MCP connector. The operation is
non-destructive: existing objects and collections are preserved, and only the
missing Shenron City hierarchy is added.
"""

from pathlib import Path

import bpy


COLLECTIONS = (
    "00_References",
    "10_Architecture",
    "20_Environment",
    "30_Props",
    "40_Characters",
    "50_Vehicles",
    "60_Vegetation",
    "70_Collision",
    "80_Lighting",
    "90_Exports",
)


def ensure_child(parent: bpy.types.Collection, name: str) -> bpy.types.Collection:
    child = bpy.data.collections.get(name)
    if child is None:
        child = bpy.data.collections.new(name)
    if child.name not in parent.children:
        parent.children.link(child)
    return child


def main() -> Path:
    script_path = Path(__file__).resolve()
    blender_root = script_path.parents[1]
    source_root = blender_root.parent
    project_path = blender_root / "ShenronCity.blend"

    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"

    root = ensure_child(scene.collection, "SHENRON_CITY")
    for name in COLLECTIONS:
        ensure_child(root, name)

    scene["shenron_animation_catalog"] = str(
        source_root / "Catalogs" / "ANIMATION_CATALOG.csv"
    )
    scene["shenron_texture_catalog"] = str(
        source_root / "Catalogs" / "TEXTURE_CATALOG.csv"
    )
    scene["shenron_animation_library"] = str(
        source_root / "Animations" / "Raw" / "Unverified"
    )
    scene["shenron_runtime_textures"] = str(
        source_root.parent / "public" / "textures"
    )
    scene["shenron_units"] = "metres; +Y up; runtime export GLB"

    bpy.ops.wm.save_as_mainfile(filepath=str(project_path), check_existing=False)
    return project_path


if __name__ == "__main__":
    print(f"Saved Shenron City project: {main()}")
