"""
94_playblast.py — render the aerial flythrough to an MP4.

Usage:
  blender -b --python 94_playblast.py -- [--half] [--every N] [--cycles]

Defaults to 1920x1080 EEVEE at every frame. --half renders 960x540, --every N
renders every Nth frame (a fast motion check).
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
    cam = bpy.data.objects.get("CAM_flythrough")
    if cam is None:
        raise RuntimeError("CAM_flythrough missing - run the cameras stage")
    scene.camera = cam

    half = "--half" in argv
    every = 1
    if "--every" in argv:
        every = int(argv[argv.index("--every") + 1])

    scene.render.engine = 'CYCLES' if "--cycles" in argv else 'BLENDER_EEVEE'
    scene.render.resolution_x = 960 if half else 1920
    scene.render.resolution_y = 540 if half else 1080
    scene.render.resolution_percentage = 100
    scene.frame_step = every

    if scene.render.engine == 'BLENDER_EEVEE':
        scene.eevee.taa_render_samples = 24

    os.makedirs(bc.PLAYBLASTS, exist_ok=True)
    tag = "flythrough%s" % ("_half" if half else "")
    n = (scene.frame_end - scene.frame_start) // every + 1

    # Render a PNG sequence and mux with system ffmpeg rather than writing the
    # container from Blender. Blender finalises the MP4's moov atom only on a
    # clean exit, so an interrupted render leaves megabytes of undecodable
    # frame data; a frame sequence is resumable and can't be truncated.
    seq_dir = os.path.join(bc.PLAYBLASTS, tag + "_frames")
    os.makedirs(seq_dir, exist_ok=True)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 15
    scene.render.filepath = os.path.join(seq_dir, "f_")

    print("[playblast] %s  %dx%d  %d frames (step %d)  engine=%s"
          % (tag, scene.render.resolution_x, scene.render.resolution_y,
             n, every, scene.render.engine))

    t0 = time.time()
    bpy.ops.render.render(animation=True)
    dt = time.time() - t0

    frames = sorted(f for f in os.listdir(seq_dir) if f.endswith(".png"))
    print("[playblast] %d frames in %.1fs (%.2fs/frame)"
          % (len(frames), dt, dt / max(1, n)))

    out = os.path.join(bc.PLAYBLASTS, tag + ".mp4")
    ff = os.environ.get("FFMPEG_BIN") or "ffmpeg"
    # Numbered pattern, not glob: Windows ffmpeg builds are compiled without
    # -pattern_type glob and fail silently with an empty stderr.
    cmd = [ff, "-y", "-framerate", str(scene.render.fps),
           "-start_number", str(scene.frame_start),
           "-i", os.path.join(seq_dir, "f_%04d.png"),
           "-c:v", "libx264", "-preset", "slow", "-crf", "18",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    import subprocess
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("[playblast] ffmpeg failed:\n", r.stderr[-1500:])
    sz = os.path.getsize(out) if os.path.exists(out) else 0
    print("[playblast] encoded -> %s  %.1f MB" % (out, sz / 1e6))
    return {"seconds": round(dt, 1), "frames": len(frames),
            "mp4": out, "mp4_mb": round(sz / 1e6, 1),
            "frames_dir": seq_dir}


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    result = main(argv)
