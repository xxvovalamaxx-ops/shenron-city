"""
35_lookdev.py — lighting / atmosphere / render tuning, applied to the built world.

Runs inside Blender against an already-generated scene, so look iterations do
not require regenerating 46k buildings.

What it fixes relative to the raw build:

* Contrast. A physical sky at full strength lights every surface from the whole
  hemisphere, which flattens a city into pale mush. Dropping the sky's diffuse
  contribution and pushing the sun restores directional shadow structure.
* Aerial perspective. A world volume scatter is what makes 20 km of city read
  as 20 km rather than a tabletop model. This is the single biggest contributor
  to the reference's look.
* Shadows. At island scale the sun's shadow settings matter more than samples.

PRESETS pick the time of day: "day" for readable structure, "golden" for the
reference's harbour passes.
"""

import importlib
import math
import sys

import bpy
from mathutils import Euler

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

PRESETS = {
    # elevation, rotation, sun energy, sun colour, sky strength, exposure
    # Low-ish elevations on purpose: at 45deg+ the shadows hide under the
    # buildings and a 20 km city reads as a flat grey plan.
    "day":    (31.0, 218.0, 5.6, (1.00, 0.945, 0.860), 0.55, -0.25),
    "golden": (10.0, 246.0, 7.0, (1.00, 0.735, 0.470), 0.42,  0.10),
    "hazy":   (24.0, 232.0, 4.8, (1.00, 0.880, 0.760), 0.66, -0.15),
}


def tune_world(preset="day"):
    el, rot, energy, suncol, sky_strength, exposure = PRESETS[preset]
    scene = bpy.context.scene
    world = scene.world
    if world is None:
        return {}
    nt = world.node_tree
    sky = next((n for n in nt.nodes if n.type == 'TEX_SKY'), None)
    bg = next((n for n in nt.nodes if n.type == 'BACKGROUND'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_WORLD'), None)

    if sky:
        sky.sun_elevation = math.radians(el)
        sky.sun_rotation = math.radians(rot)
        sky.sun_disc = False          # the SUN lamp provides the disc + shadows
        sky.air_density = 1.05
        sky.aerosol_density = 0.85 if preset == "day" else 1.6
        sky.ozone_density = 1.0
    if bg:
        # Sky lights the scene from every direction at once; at full strength
        # that erases the shadow structure the city is read by.
        bg.inputs["Strength"].default_value = sky_strength

    # ---- aerial perspective ---------------------------------------------
    # A world volume scatter is the physically correct way to do this and it is
    # what Cycles wants, but EEVEE's froxel volumetrics cannot integrate a
    # 45 km range and return an essentially black frame. The mist pass driving
    # a compositor mix gives the same read, costs nothing, and stays
    # controllable. Make sure any previously linked volume is removed.
    if out is not None:
        for link in list(out.inputs["Volume"].links):
            nt.links.remove(link)
    for n in [n for n in nt.nodes if n.type == 'VOLUME_SCATTER']:
        nt.nodes.remove(n)

    ms = world.mist_settings
    ms.use_mist = True
    ms.start = 1400.0
    ms.depth = 62000.0        # 30 km buried the whole island in fog
    ms.falloff = 'INVERSE_QUADRATIC'
    ms.height = 0.0
    ms.intensity = 0.0

    # ---- key light -------------------------------------------------------
    sun = bpy.data.objects.get("LGT_key_sun")
    if sun and sun.type == 'LIGHT':
        sun.data.energy = energy
        sun.data.color = suncol
        sun.data.angle = math.radians(0.95)
        sun.rotation_euler = Euler(
            (math.pi / 2 - math.radians(el), 0.0, math.radians(rot)), 'XYZ')
        if hasattr(sun.data, "use_shadow"):
            sun.data.use_shadow = True
        for attr, val in (("shadow_buffer_clip_start", 1.0),
                          ("shadow_cascade_max_distance", 40000.0),
                          ("shadow_cascade_count", 4),
                          ("shadow_filter_radius", 1.0),
                          # EEVEE Next virtual shadow maps: the default target
                          # resolution is far finer than a 20 km scene can pay
                          # for, so relax it or the maps thrash and drop out.
                          ("shadow_maximum_resolution", 0.02),
                          ("use_shadow_jitter", True)):
            if hasattr(sun.data, attr):
                try:
                    setattr(sun.data, attr, val)
                except Exception:
                    pass
    bpy.context.scene["_preset_exposure"] = exposure
    return {"preset": preset, "sun_elevation": el, "exposure_preset": exposure}


HAZE_COLOR = {
    "day":    (0.150, 0.172, 0.208, 1.0),
    "golden": (0.260, 0.196, 0.140, 1.0),
    "hazy":   (0.168, 0.183, 0.212, 1.0),
}
HAZE_STRENGTH = {"day": 0.60, "golden": 0.74, "hazy": 0.80}


def build_haze_compositor(preset="day", strength=None):
    """
    Mist-pass aerial perspective: blend the beauty toward a horizon colour by
    depth. This is what sells 20 km of city; without it every building reads
    at the same distance and the island looks like a tabletop model.
    """
    scene = bpy.context.scene
    if strength is None:
        strength = HAZE_STRENGTH.get(preset, 0.60)
    for vl in scene.view_layers:
        vl.use_pass_mist = True

    # Blender 5.x: the compositor is a node *group* assigned to the scene,
    # terminated by NodeGroupOutput. CompositorNodeComposite and the old
    # CompositorNodeMixRGB no longer exist.
    name = "NG_haze_comp"
    ng = bpy.data.node_groups.get(name)
    if ng is None:
        ng = bpy.data.node_groups.new(name, 'CompositorNodeTree')
    ng.nodes.clear()
    for item in list(ng.interface.items_tree):
        ng.interface.remove(item)
    ng.interface.new_socket(name="Image", in_out='OUTPUT',
                            socket_type='NodeSocketColor')

    rl = ng.nodes.new("CompositorNodeRLayers")
    rl.scene = scene
    rl.location = (-620, 0)

    gout = ng.nodes.new("NodeGroupOutput")
    gout.location = (520, 0)

    # shape the mist ramp so near buildings stay clean and distance builds fast
    ramp = ng.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-330, -240)
    cr = ramp.color_ramp
    cr.elements[0].position = 0.02
    cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = 0.88
    cr.elements[1].color = (strength, strength, strength, 1)

    mix = ng.nodes.new("ShaderNodeMixRGB")
    mix.location = (150, 0)
    mix.blend_type = 'MIX'
    mix.inputs["Color2"].default_value = HAZE_COLOR.get(preset,
                                                        HAZE_COLOR["day"])

    ng.links.new(rl.outputs["Image"], mix.inputs["Color1"])
    if "Mist" in rl.outputs:
        ng.links.new(rl.outputs["Mist"], ramp.inputs["Fac"])
        ng.links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    ng.links.new(mix.outputs["Color"], gout.inputs[0])

    scene.compositing_node_group = ng
    scene.use_nodes = True
    return {"haze_compositor": preset, "strength": strength,
            "mist_pass": scene.view_layers[0].use_pass_mist}


def tune_render():
    scene = bpy.context.scene
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = scene.get("_preset_exposure", -0.25)
    scene.view_settings.gamma = 1.0

    ee = scene.eevee
    for attr, val in (
        ("taa_render_samples", 48),
        ("taa_samples", 12),
        ("use_raytracing", True),
        ("use_shadows", True),
        ("shadow_ray_count", 2),
        ("shadow_step_count", 6),
        ("use_volumetric_shadows", False),
        ("volumetric_start", 8.0),
        ("volumetric_end", 45000.0),
        ("volumetric_samples", 96),
        ("volumetric_sample_distribution", 0.9),
        ("use_shadow_jitter_viewport", True),
        ("clamp_surface_indirect", 8.0),
    ):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass

    rt = getattr(ee, "ray_tracing_options", None)
    if rt is not None:
        for attr, val in (("use_denoise", True),
                          ("screen_trace_max_roughness", 0.5),
                          ("resolution_scale", "2")):
            if hasattr(rt, attr):
                try:
                    setattr(rt, attr, val)
                except Exception:
                    pass

    # Cycles path for hero stills
    try:
        scene.cycles.samples = 200
        scene.cycles.use_denoising = True
        scene.cycles.device = 'GPU'
        scene.cycles.max_bounces = 4
        scene.cycles.volume_bounces = 1
        scene.cycles.volume_max_steps = 256
        scene.cycles.volume_step_rate = 8.0
        scene.cycles.film_exposure = 1.0
    except Exception:
        pass

    # cameras need a far clip that actually reaches New Jersey
    for cam in bpy.data.cameras:
        cam.clip_start = 5.0
        cam.clip_end = 120000.0
    return {"engine": scene.render.engine,
            "exposure": scene.view_settings.exposure}


def tune_materials():
    """A few targeted albedo corrections that only became obvious once lit."""
    land = bpy.data.materials.get("MAT_land")
    if land and land.node_tree:
        b = next((n for n in land.node_tree.nodes
                  if n.type == 'BSDF_PRINCIPLED'), None)
        if b:
            # context land was reading as bright snow next to the water
            b.inputs["Base Color"].default_value = (0.043, 0.041, 0.036, 1.0)
            b.inputs["Roughness"].default_value = 0.95

    water = bpy.data.materials.get("MAT_water")
    if water and water.node_tree:
        b = next((n for n in water.node_tree.nodes
                  if n.type == 'BSDF_PRINCIPLED'), None)
        if b:
            b.inputs["Base Color"].default_value = (0.005, 0.011, 0.020, 1.0)
            # A near-mirror river goes to flat white at grazing aerial angles
            # because Fresnel hands it the whole bright sky. Roughening breaks
            # the reflection into the chop the reference shows.
            b.inputs["Roughness"].default_value = 0.105
        # push the wave bump up to match the rougher surface
        for n in water.node_tree.nodes:
            if n.type == 'BUMP':
                n.inputs["Strength"].default_value = min(
                    0.55, n.inputs["Strength"].default_value * 1.9)
    return {"tuned": ["MAT_land", "MAT_water"]}


def main(preset="day"):
    r = {}
    r.update(tune_world(preset))
    r.update(build_haze_compositor(preset))
    r.update(tune_render())
    r.update(tune_materials())
    return r


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = next((a for a in argv if a in PRESETS), "day")
    result = main(p)
    print(result)
