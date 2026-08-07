"""
32_cameras.py — hero cameras plus the aerial flythrough.

Runs inside Blender. Idempotent (purges 13_cameras).

Creates:
  * six named still cameras covering the deliverable shot list
  * CAM_flythrough, a keyframed 24 s aerial that starts out over the Upper Bay,
    runs the length of the island past the Midtown cluster, banks across
    Central Park and finishes on a high oblique of the whole world

Keyframed transforms are used rather than a Follow Path constraint: at this
scale the constraint's evaluation order against the mist pass and the traffic
node tree is fiddly, and explicit keys make the motion directly editable.
"""

import importlib
import math
import sys

import bpy
from mathutils import Euler, Vector

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

FPS = 30
DURATION_S = 24
CLIP_END = 120000.0

# name -> (location, look_at, lens)
STILLS = {
    "CAM_hero_wide":    ((-11000, -19500, 9200), (400, 1400, 0), 46),
    "CAM_harbour":      ((-1500, -15200, 3000), (200, -2600, 250), 40),
    "CAM_downtown":     ((-6200, -12800, 1750), (-1800, -7600, 180), 58),
    "CAM_midtown":      ((8600, -5200, 2050), (-900, -1200, 260), 52),
    "CAM_centralpark":  ((900, 9600, 2500), (-100, 1000, 180), 42),
    "CAM_bridges":      ((6200, -9100, 1150), (-1200, -7700, 120), 55),
    "CAM_uptown":       ((-7200, 12500, 2400), (-400, 5200, 150), 48),
}

# flythrough: (frame_fraction, camera position, look-at target)
PATH = [
    (0.00, (-2200, -19000, 4200), (0, -8000, 300)),
    (0.14, (-2600, -13500, 2600), (-1400, -7200, 250)),
    (0.30, (-5200, -8200, 1700), (-1500, -4200, 300)),
    (0.46, (-4600, -3600, 1500), (-600, 400, 400)),
    (0.60, (-3000, 1200, 1750), (200, 4200, 300)),
    (0.74, (2600, 5200, 1900), (-500, 6400, 200)),
    (0.86, (7000, 7600, 3300), (-1200, 3000, 200)),
    (1.00, (13500, -2200, 7600), (-1500, -2400, 0)),
]


def make_cam(name, loc, target, lens):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    # Aerial cameras never need 4 m near clipping, and a tight near plane is
    # what starves the depth buffer at city scale. 60 m buys ~15x precision.
    cd.clip_start = 60.0
    cd.clip_end = CLIP_END
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat(
        '-Z', 'Y').to_euler()
    bc.link_to(ob, "13_cameras")
    return ob


def build_flythrough(scene):
    total = FPS * DURATION_S
    scene.frame_start = 1
    scene.frame_end = total
    scene.render.fps = FPS

    cd = bpy.data.cameras.new("CAM_flythrough")
    cd.lens = 34.0
    # Aerial cameras never need 4 m near clipping, and a tight near plane is
    # what starves the depth buffer at city scale. 60 m buys ~15x precision.
    cd.clip_start = 60.0
    cd.clip_end = CLIP_END
    cam = bpy.data.objects.new("CAM_flythrough", cd)
    bc.link_to(cam, "13_cameras")

    for (f, loc, target) in PATH:
        frame = 1 + int(round(f * (total - 1)))
        cam.location = loc
        d = Vector(target) - Vector(loc)
        eul = d.to_track_quat('-Z', 'Y').to_euler()
        # bank into the turns a little so it feels flown, not slid
        eul.rotate_axis('Z', 0.0)
        cam.rotation_euler = eul
        cam.keyframe_insert("location", frame=frame)
        cam.keyframe_insert("rotation_euler", frame=frame)

    if cam.animation_data and cam.animation_data.action:
        for fc in _fcurves(cam):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO_CLAMPED'
                kp.handle_right_type = 'AUTO_CLAMPED'
    return cam, total


def _fcurves(ob):
    """Blender 5.x keeps fcurves inside action slots/layers, 4.x on the action."""
    act = ob.animation_data.action
    if hasattr(act, "fcurves") and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                out.extend(list(bag.fcurves))
    return out


def main():
    bc.purge_collection("13_cameras")
    scene = bpy.context.scene

    made = []
    for name, (loc, target, lens) in STILLS.items():
        make_cam(name, loc, target, lens)
        made.append(name)

    cam, total = build_flythrough(scene)
    scene.camera = bpy.data.objects.get("CAM_hero_wide") or cam

    return {"stills": made, "flythrough": cam.name,
            "frames": total, "fps": FPS,
            "keyframes": len(PATH),
            "scene_camera": scene.camera.name}


if __name__ == "__main__":
    result = main()
    print(result)
