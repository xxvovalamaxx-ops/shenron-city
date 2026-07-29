"""Render and record the production evidence package for the forest shrine.

Blender 5.1 locks ``-F OPEN_EXR_MULTILAYER`` for the lifetime of a background
process, so run the reproducible final in two phases:

    blender scene.blend --background -F OPEN_EXR_MULTILAYER \
      --python finalize_japanese_forest_shrine.py -- --mode exr
    blender scene.blend --background \
      --python finalize_japanese_forest_shrine.py -- --mode png
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import bpy


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
FINAL_DIR = ROOT / "docs" / "Assets" / "Previews" / "Final"
PASSES_DIR = FINAL_DIR / "Passes"
EXACT_PNG = FINAL_DIR / "japanese-forest-shrine-final-1937x1079.png"
HIGH_PNG = FINAL_DIR / "japanese-forest-shrine-final-3840x2140.png"
EXR_PATH = PASSES_DIR / "japanese-forest-shrine-final-multilayer.exr"
METRICS_PATH = FINAL_DIR / "japanese-forest-shrine-render-metrics.json"
BLEND_PATH = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Working"
    / "Japanese_Forest_Shrine_Realistic.blend"
)


def configure_gpu(scene: bpy.types.Scene) -> list[dict[str, object]]:
    """Prefer OptiX, with CUDA as the legal NVIDIA fallback."""
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None:
        return []

    preferences = addon.preferences
    backend = "OPTIX"
    try:
        preferences.compute_device_type = backend
    except Exception:
        backend = "CUDA"
        preferences.compute_device_type = backend

    preferences.get_devices()
    devices: list[dict[str, object]] = []
    for device in preferences.devices:
        enabled = device.type == backend
        device.use = enabled
        devices.append(
            {
                "name": device.name,
                "type": device.type,
                "enabled": enabled,
            }
        )
    return devices


def configure_cycles(scene: bpy.types.Scene) -> None:
    scene.cycles.samples = 512
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.005
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 5
    scene.cycles.transmission_bounces = 5
    scene.cycles.volume_bounces = 3
    scene.cycles.transparent_max_bounces = 10
    scene.cycles.use_light_tree = True
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0


def configure_passes(scene: bpy.types.Scene) -> list[str]:
    layer = bpy.context.view_layer
    layer.use_pass_diffuse_color = True
    layer.use_pass_normal = True
    layer.use_pass_z = True
    layer.use_pass_mist = True
    layer.use_pass_cryptomatte_object = True
    layer.use_pass_cryptomatte_material = True
    layer.use_pass_cryptomatte_asset = True
    layer.pass_cryptomatte_depth = 6

    world = scene.world
    if world is not None:
        world.mist_settings.start = 8.0
        world.mist_settings.depth = 58.0
        world.mist_settings.falloff = "QUADRATIC"

    for existing in list(layer.aovs):
        if existing.name == "Roughness":
            layer.aovs.remove(existing)
    roughness_aov = layer.aovs.add()
    roughness_aov.name = "Roughness"
    roughness_aov.type = "VALUE"

    configured_materials = 0
    for material in bpy.data.materials:
        if not material.use_nodes or material.node_tree is None:
            continue
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        for old_node in [
            node
            for node in nodes
            if node.bl_idname == "ShaderNodeOutputAOV"
            and getattr(node, "aov_name", "") == "Roughness"
        ]:
            nodes.remove(old_node)

        principled = next(
            (
                node
                for node in nodes
                if node.bl_idname == "ShaderNodeBsdfPrincipled"
            ),
            None,
        )
        if principled is None:
            continue

        aov_node = nodes.new("ShaderNodeOutputAOV")
        aov_node.name = "JF_Roughness_AOV"
        aov_node.label = "Roughness AOV"
        aov_node.aov_name = "Roughness"
        roughness = principled.inputs.get("Roughness")
        if roughness is not None and roughness.is_linked:
            links.new(roughness.links[0].from_socket, aov_node.inputs["Value"])
        elif roughness is not None:
            aov_node.inputs["Value"].default_value = float(
                roughness.default_value
            )
        else:
            aov_node.inputs["Value"].default_value = 0.5
        configured_materials += 1

    return [
        "Combined",
        "DiffCol (albedo)",
        "Normal",
        "Depth (Z)",
        "Mist",
        "Roughness",
        "CryptoObject",
        "CryptoMaterial",
        "CryptoAsset",
        f"Roughness materials configured: {configured_materials}",
    ]


def set_resolution(scene: bpy.types.Scene, width: int, height: int) -> None:
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100


def render_exact_multilayer(scene: bpy.types.Scene) -> float:
    set_resolution(scene, 1937, 1079)
    scene.render.filepath = str(EXR_PATH)
    image_settings = scene.render.image_settings
    # Blender 5.1's Windows background build exposes the multilayer enum but
    # only accepts it through the command-line ``-F`` override. The production
    # command therefore starts with ``-F OPEN_EXR_MULTILAYER``.
    if image_settings.file_format != "OPEN_EXR_MULTILAYER":
        raise RuntimeError(
            "Start Blender with: -F OPEN_EXR_MULTILAYER"
        )
    image_settings.color_mode = "RGBA"
    image_settings.color_depth = "16"
    image_settings.exr_codec = "ZIP"

    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    elapsed = time.perf_counter() - started

    return elapsed


def render_exact_png(scene: bpy.types.Scene) -> float:
    set_resolution(scene, 1937, 1079)
    image_settings = scene.render.image_settings
    image_settings.file_format = "PNG"
    image_settings.color_mode = "RGBA"
    image_settings.color_depth = "16"
    scene.render.filepath = str(EXACT_PNG)

    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return time.perf_counter() - started


def render_high_resolution(scene: bpy.types.Scene) -> float:
    set_resolution(scene, 3840, 2140)
    image_settings = scene.render.image_settings
    image_settings.file_format = "PNG"
    image_settings.color_mode = "RGBA"
    image_settings.color_depth = "16"
    scene.render.filepath = str(HIGH_PNG)

    started = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    return time.perf_counter() - started


def scene_counts(scene: bpy.types.Scene) -> dict[str, int]:
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    return {
        "objects": len(scene.objects),
        "mesh_objects": len(meshes),
        "materials": len(bpy.data.materials),
        "images": len(bpy.data.images),
        "collections": len(bpy.data.collections),
        "vertices_source": sum(len(obj.data.vertices) for obj in meshes),
        "polygons_source": sum(len(obj.data.polygons) for obj in meshes),
        "ancient_stair_stones": int(
            scene.get("ancient_stair_stone_count", 0)
        ),
    }


def requested_mode() -> str:
    if "--" not in sys.argv:
        return (
            "exr"
            if bpy.context.scene.render.image_settings.file_format
            == "OPEN_EXR_MULTILAYER"
            else "png"
        )
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if "--mode" not in arguments:
        return (
            "exr"
            if bpy.context.scene.render.image_settings.file_format
            == "OPEN_EXR_MULTILAYER"
            else "png"
        )
    index = arguments.index("--mode")
    return arguments[index + 1].lower()


def main() -> dict[str, object]:
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    PASSES_DIR.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    devices = configure_gpu(scene)
    configure_cycles(scene)
    passes = configure_passes(scene)
    counts = scene_counts(scene)
    mode = requested_mode()

    exact_multilayer_seconds: float | None = None
    exact_png_seconds: float | None = None
    high_seconds: float | None = None
    if mode in {"all", "exr"}:
        exact_multilayer_seconds = render_exact_multilayer(scene)
    if mode in {"all", "png"}:
        exact_png_seconds = render_exact_png(scene)
        high_seconds = render_high_resolution(scene)

    set_resolution(scene, 1937, 1079)
    scene.render.filepath = str(EXACT_PNG)
    if mode in {"all", "png"}:
        scene.render.image_settings.file_format = "PNG"
    scene["final_render_samples"] = 512
    scene["final_adaptive_threshold"] = 0.005
    if exact_multilayer_seconds is not None:
        scene["final_exact_multilayer_render_seconds"] = (
            exact_multilayer_seconds
        )
    if exact_png_seconds is not None:
        scene["final_exact_png_render_seconds"] = exact_png_seconds
    if high_seconds is not None:
        scene["final_high_render_seconds"] = high_seconds
    scene["final_multilayer_exr"] = str(EXR_PATH)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)

    outputs = {}
    for path in (EXACT_PNG, HIGH_PNG, EXR_PATH, BLEND_PATH):
        outputs[path.name] = {
            "path": str(path),
            "bytes": path.stat().st_size if path.exists() else 0,
        }

    metrics: dict[str, object] = {
        "status": "complete",
        "blender_version": bpy.app.version_string,
        "render_engine": scene.render.engine,
        "cycles_device": scene.cycles.device,
        "devices": devices,
        "samples": 512,
        "adaptive_threshold": 0.005,
        "max_bounces": 12,
        "denoiser": getattr(scene.cycles, "denoiser", "unknown"),
        "exact_resolution": [1937, 1079],
        "high_resolution": [3840, 2140],
        "mode": mode,
        "exact_multilayer_render_seconds": (
            round(exact_multilayer_seconds, 3)
            if exact_multilayer_seconds is not None
            else None
        ),
        "exact_png_render_seconds": (
            round(exact_png_seconds, 3)
            if exact_png_seconds is not None
            else None
        ),
        "high_render_seconds": (
            round(high_seconds, 3)
            if high_seconds is not None
            else None
        ),
        "passes": passes,
        "scene_counts": counts,
        "outputs": outputs,
    }
    METRICS_PATH.write_text(
        json.dumps(metrics, indent=2),
        encoding="utf-8",
    )
    return metrics


if __name__ == "__main__":
    result = main()
    print("JF_FINAL_METRICS=" + json.dumps(result, sort_keys=True))
