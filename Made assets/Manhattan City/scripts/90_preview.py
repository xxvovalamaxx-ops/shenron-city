"""
90_preview.py — headless validation renders of the Manhattan world.

Usage:
  blender -b blend/manhattan_world.blend --factory-startup --python 90_preview.py -- <shot> [shot...]
  (or without --factory-startup so addons load; the script opens the blend itself
   when run standalone)

Shots are defined in SHOTS below. Each renders a PNG into renders/.
"plan" is the fastest correctness check: a top-down orthographic of the whole
island, which immediately shows whether the footprint and density are right.
"""

import math
import os
import sys
import time

import bpy
from mathutils import Euler, Vector

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402

# name -> dict(loc, look_at | rot, lens, ortho_scale, res, engine, samples)
SHOTS = {
    # whole-island orthographic plan - validates footprint + density
    "plan": dict(kind="ORTHO", loc=(260, 900, 14000), rot=(0, 0, 0),
                 ortho_scale=21000, res=(1100, 2200), samples=8),

    # the reference's signature shot: low over the harbour looking north
    "harbour": dict(kind="PERSP", loc=(-1200, -14500, 3100),
                    look_at=(300, -2000, 250), lens=42, res=(1920, 1080),
                    samples=24),

    # midtown skyline from the east river
    "midtown": dict(kind="PERSP", loc=(7000, -1800, 2100),
                    look_at=(-200, 1500, 300), lens=55, res=(1920, 1080),
                    samples=24),

    # lower manhattan cluster from the south west
    "downtown": dict(kind="PERSP", loc=(-5200, -10500, 1500),
                     look_at=(-800, -6800, 200), lens=60, res=(1920, 1080),
                     samples=24),

    # central park looking south over the midtown wall
    "centralpark": dict(kind="PERSP", loc=(-500, 8200, 2600),
                        look_at=(200, 1200, 200), lens=40, res=(1920, 1080),
                        samples=24),

    # high oblique over the whole island
    "hero": dict(kind="PERSP", loc=(-9000, -17000, 8200),
                 look_at=(300, 1000, 0), lens=50, res=(1920, 1080),
                 samples=32),
}


def make_camera(name, spec):
    cam = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name, cam)
    bc.link_to(ob, "13_cameras")

    cam.clip_start = 5.0
    cam.clip_end = 120000.0

    if spec["kind"] == "ORTHO":
        cam.type = 'ORTHO'
        cam.ortho_scale = spec["ortho_scale"]
        ob.location = spec["loc"]
        ob.rotation_euler = Euler(spec.get("rot", (0, 0, 0)), 'XYZ')
    else:
        cam.type = 'PERSP'
        cam.lens = spec.get("lens", 50)
        ob.location = spec["loc"]
        d = Vector(spec["look_at"]) - Vector(spec["loc"])
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def render(name, spec, engine="BLENDER_EEVEE", out_dir=None):
    scene = bpy.context.scene
    out_dir = out_dir or bc.RENDERS
    os.makedirs(out_dir, exist_ok=True)

    cam = bpy.data.objects.get("CAM_" + name) or make_camera("CAM_" + name, spec)
    scene.camera = cam

    r = scene.render
    r.resolution_x, r.resolution_y = spec.get("res", (1920, 1080))
    r.resolution_percentage = 100
    r.engine = engine
    r.image_settings.file_format = 'PNG'

    if engine == 'CYCLES':
        scene.cycles.samples = spec.get("samples", 24)
        scene.cycles.use_denoising = True
        scene.cycles.device = 'GPU'
    else:
        scene.eevee.taa_render_samples = spec.get("samples", 16)

    path = os.path.join(out_dir, "%s.png" % name)
    r.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    size = os.path.getsize(path) if os.path.exists(path) else 0
    print("[render] %-12s %6.1fs  %8.0f KB  %s" % (name, dt, size / 1024, path))
    return {"shot": name, "seconds": round(dt, 1), "kb": round(size / 1024),
            "path": path}


def main(argv):
    shots = [a for a in argv if a in SHOTS] or ["plan"]
    engine = 'CYCLES' if "--cycles" in argv else 'BLENDER_EEVEE'

    blend = os.path.join(bc.BLEND, "manhattan_world.blend")
    if bpy.data.filepath != blend and os.path.exists(blend):
        bpy.ops.wm.open_mainfile(filepath=blend)

    out = []
    for s in shots:
        try:
            out.append(render(s, SHOTS[s], engine))
        except Exception as e:
            import traceback
            traceback.print_exc()
            out.append({"shot": s, "ERROR": str(e)})
    print(out)
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    result = main(argv)
