"""
10_scene_setup.py — create the empty Manhattan world .blend and its scaffolding.

Run inside Blender. Safe to re-run: it rebuilds the file from scratch.

Creates:
  - a clean scene at 1 unit = 1 metre
  - the full 00_..14_ collection hierarchy
  - a Nishita sky world with atmospheric haze matching the reference look
  - render settings for both fast EEVEE playblasts and Cycles/OptiX hero stills
  - saves to blend/manhattan_world.blend
"""

import importlib
import os
import sys

import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)


def guard_existing_file():
    """Refuse to blow away unsaved work in whatever file is currently open."""
    if bpy.data.is_dirty and bpy.data.filepath:
        raise RuntimeError(
            "Current file has unsaved changes (%s) - save it first."
            % bpy.data.filepath)


def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    scene.name = "Manhattan"
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = 'METERS'
    return scene


def build_world(scene, sun_elevation_deg=33.0, sun_rotation_deg=232.0):
    """
    Physical sky. Mid-afternoon sun with moderate haze: enough aerial
    perspective to sell 20 km of city, but not so much that the whole frame
    goes milky (which is what happens past ~2.0 aerosol at low sun angles).
    """
    world = bpy.data.worlds.new("WORLD_manhattan_sky")
    scene.world = world
    if not world.node_tree:           # <5.0 needed the explicit toggle
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (400, 0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (200, 0)
    bg.inputs["Strength"].default_value = 1.0

    import math
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.location = (-60, 0)
    # Blender 5.x replaced NISHITA with the scattering models; MULTIPLE_SCATTERING
    # is its direct successor and gives richer horizon haze.
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_elevation = math.radians(sun_elevation_deg)
    sky.sun_rotation = math.radians(sun_rotation_deg)
    sky.sun_intensity = 0.75
    sky.sun_size = math.radians(1.0)
    sky.altitude = 150.0
    sky.air_density = 1.15      # >1 pushes the blue haze that reads as distance
    sky.aerosol_density = 1.05  # (was dust_density pre-5.0)
    sky.ozone_density = 1.0

    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    return world


def build_sun(scene, elevation_deg=33.0, rotation_deg=232.0):
    """Key light matched to the sky's sun vector."""
    import math
    from mathutils import Euler

    data = bpy.data.lights.new("LGT_key_sun", type='SUN')
    data.energy = 3.0
    data.angle = math.radians(1.4)
    data.color = (1.0, 0.93, 0.82)
    ob = bpy.data.objects.new("LGT_key_sun", data)
    bc.link_to(ob, "12_lighting")

    # Nishita: rotation is compass-style, elevation from horizon.
    el = math.radians(elevation_deg)
    az = math.radians(rotation_deg)
    ob.rotation_euler = Euler((math.pi / 2 - el, 0.0, az), 'XYZ')
    ob.location = (0, 0, 3000)
    return ob


def configure_render(scene):
    r = scene.render
    r.resolution_x = 1920
    r.resolution_y = 1080
    r.resolution_percentage = 100
    r.fps = 30
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGB'
    r.film_transparent = False

    # AgX gives the soft highlight rolloff the reference has on water glint.
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
        scene.view_settings.exposure = -0.55
    except Exception:
        pass

    # Cycles / OptiX for hero stills.
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'OPTIX'
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = (d.type == 'OPTIX')
        scene.cycles.device = 'GPU'
        scene.cycles.samples = 256
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 4
        scene.cycles.diffuse_bounces = 2
        scene.cycles.glossy_bounces = 2
        scene.cycles.transmission_bounces = 2
        scene.cycles.transparent_max_bounces = 4
        scene.cycles.use_fast_gi = True
    except Exception as e:
        print("cycles config skipped:", e)

    # EEVEE is the workhorse for city-scale playblasts.
    try:
        ee = scene.eevee
        ee.taa_render_samples = 32
        ee.taa_samples = 8
        if hasattr(ee, "use_raytracing"):
            ee.use_raytracing = True
        if hasattr(ee, "use_shadow_jitter_viewport"):
            ee.use_shadow_jitter_viewport = True
        if hasattr(ee, "shadow_ray_count"):
            ee.shadow_ray_count = 2
        if hasattr(ee, "use_volumetric_lights"):
            ee.use_volumetric_lights = True
        if hasattr(ee, "volumetric_end"):
            ee.volumetric_end = 30000.0
        if hasattr(ee, "volumetric_samples"):
            ee.volumetric_samples = 64
    except Exception as e:
        print("eevee config skipped:", e)

    scene.render.engine = 'BLENDER_EEVEE'
    return r


def main(guard=True):
    if guard:
        guard_existing_file()
    scene = reset_scene()
    bc.ensure_collections(scene)
    build_world(scene)
    build_sun(scene)
    configure_render(scene)

    for d in (bc.BLEND, bc.RENDERS, bc.PLAYBLASTS, bc.EXPORTS, bc.DOCS, bc.CACHE):
        os.makedirs(d, exist_ok=True)

    path = os.path.join(bc.BLEND, "manhattan_world.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)

    return {
        "saved": path,
        "scene": scene.name,
        "collections": [c.name for c in scene.collection.children],
        "engine": scene.render.engine,
        "world": scene.world.name,
    }


if __name__ == "__main__":
    result = main()
    print(result)
