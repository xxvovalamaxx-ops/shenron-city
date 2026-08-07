"""
92_shots.py — render the deliverable still set from the cameras in the blend.

Usage:
  blender -b --python 92_shots.py -- [cam names...] [--cycles] [--half]

With no camera names it renders every CAM_* object in 13_cameras.
"""

import os
import sys
import time

import bpy

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402


def main(argv):
    blend = os.path.join(bc.BLEND, "manhattan_world.blend")
    if bpy.data.filepath != blend:
        bpy.ops.wm.open_mainfile(filepath=blend)

    scene = bpy.context.scene
    cycles = "--cycles" in argv
    half = "--half" in argv
    names = [a for a in argv if a.startswith("CAM_")]

    col = bpy.data.collections.get("13_cameras")
    cams = [o for o in (col.objects if col else bpy.data.objects)
            if o.type == 'CAMERA']
    if names:
        cams = [c for c in cams if c.name in names]
    cams = [c for c in cams if c.name != "CAM_flythrough"]

    scene.render.engine = 'CYCLES' if cycles else 'BLENDER_EEVEE'
    if cycles:
        scene.cycles.samples = 128
        scene.cycles.device = 'GPU'
        scene.cycles.use_denoising = True
    scene.render.resolution_x = 960 if half else 1920
    scene.render.resolution_y = 540 if half else 1080
    scene.render.image_settings.file_format = 'PNG'

    os.makedirs(bc.RENDERS, exist_ok=True)
    out = []
    for cam in sorted(cams, key=lambda c: c.name):
        scene.camera = cam
        tag = cam.name.replace("CAM_", "")
        path = os.path.join(bc.RENDERS, "shot_%s.png" % tag)
        scene.render.filepath = path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        sz = os.path.getsize(path) if os.path.exists(path) else 0
        out.append({"cam": cam.name, "s": round(time.time() - t0, 1),
                    "kb": round(sz / 1024)})
        print("[shot] %-20s %5.1fs %7d KB" % (cam.name, out[-1]["s"],
                                              out[-1]["kb"]))
    print(out)
    return out


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    result = main(argv)
