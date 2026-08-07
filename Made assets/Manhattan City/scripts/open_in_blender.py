"""
open_in_blender.py — startup script for viewing the Manhattan world interactively.

Passed to a *fresh* Blender GUI instance via --python so the artist's existing
session is never touched:

  blender.exe "blend/manhattan_world.blend" --python scripts/open_in_blender.py

Why this is needed: the world is ~21 km long and the default viewport clip_end
is 1000 m, so opening the file cold shows an empty grey void - everything is
behind the far clip plane. This sets sane clipping, frames the island, and
switches to material shading.
"""

import bpy


def setup_viewport():
    touched = 0
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != 'VIEW_3D':
                continue
            for space in area.spaces:
                if space.type != 'VIEW_3D':
                    continue
                # A 21 km city is entirely beyond the default 1 km far clip.
                space.clip_start = 2.0
                space.clip_end = 200000.0
                space.shading.type = 'MATERIAL'
                space.shading.use_scene_world = True
                space.shading.use_scene_lights = True
                space.overlay.show_relationship_lines = False
                space.overlay.show_extras = False
                space.lens = 35.0
                # Snap to the hero camera: guessing a view quaternion for a
                # 21 km scene reliably lands you inside a building or in the
                # middle of the Atlantic. The camera is already framed.
                cam = bpy.data.objects.get("CAM_hero_wide")
                if cam:
                    bpy.context.scene.camera = cam
                    space.region_3d.view_perspective = 'CAMERA'
                else:
                    r3d = space.region_3d
                    r3d.view_perspective = 'PERSP'
                    r3d.view_location = (0.0, -1500.0, 400.0)
                    r3d.view_distance = 16000.0
                touched += 1
    return touched


def report():
    scene = bpy.context.scene
    counts = {}
    for c in bpy.data.collections:
        n = len(c.objects)
        if n:
            counts[c.name] = n
    tris = sum(len(o.data.polygons) for o in bpy.data.objects
               if o.type == 'MESH' and o.data)
    verts = sum(len(o.data.vertices) for o in bpy.data.objects
                if o.type == 'MESH' and o.data)
    print("=" * 62)
    print("MANHATTAN WORLD LOADED")
    print("  scene        : %s   engine %s" % (scene.name, scene.render.engine))
    print("  objects      : %d   verts %s   faces %s"
          % (len(scene.objects), format(verts, ","), format(tris, ",")))
    print("  frame range  : %d - %d @ %d fps"
          % (scene.frame_start, scene.frame_end, scene.render.fps))
    print("  collections  :")
    for k in sorted(counts):
        print("      %-14s %d" % (k, counts[k]))
    print("  cameras      : %s"
          % ", ".join(sorted(o.name for o in bpy.data.objects
                             if o.type == 'CAMERA')))
    print("  TIP: numpad-0 for camera view. Cameras are in 13_cameras.")
    print("       Press space to play the flythrough (720 frames).")
    print("=" * 62)


def main():
    n = setup_viewport()
    report()
    print("[viewport] configured %d 3D view(s) with 200 km far clip" % n)


# Blender runs --python scripts before the UI is fully ready in some builds,
# so defer one tick via a timer.
def _deferred():
    try:
        main()
    except Exception as e:
        print("open_in_blender deferred setup failed:", e)
    return None


try:
    bpy.app.timers.register(_deferred, first_interval=0.35)
except Exception:
    main()
