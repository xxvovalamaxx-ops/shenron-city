"""
Fix CC3 upper arm rest pose to reduce hand clipping.

The Quaternius source and CC3 Sketchfab target have ~97 deg different upper
arm rest orientations. This script rotates the upper arm bones in the CC3
model's edit pose to better match the source, reducing how much the hands
clip into the torso during animation.

Usage in Blender:
  1. File > Import > glTF 2.0  ->  public/models/characters/player/player.glb
  2. Open this script in Blender's Text Editor
  3. Click "Run Script"
  4. File > Export > glTF 2.0  ->  overwrite player.glb
     (Check: Selected Objects off, apply modifiers, include armature)

Targets Blender 4.x.
"""

import bpy
import math
from mathutils import Quaternion

# Correction quaternions (xyzw) computed as srcLocal * inverse(tgtLocal)
# for each upper arm bone. These rotate the CC3 rest pose toward the
# Quaternius orientation.
CORRECTIONS = {
    "upperarm_l_024": Quaternion((0.1079824306182026, 0.44904925980220955, -0.20673745152368522, 0.8625277868488438)),
    "upperarm_r_049": Quaternion((0.20703382998978342, -0.8625652739112248, 0.10741324304957096, 0.44897721178227845)),
}


def fix_upper_arms():
    armature = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            armature = obj
            break
    if armature is None:
        print("ERROR: No armature found in the scene")
        return

    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")

    edited = 0
    for bone_name, correction in CORRECTIONS.items():
        bone = armature.data.edit_bones.get(bone_name)
        if bone is None:
            print(f"WARNING: bone '{bone_name}' not found, skipping")
            continue

        # Store current head/tail positions
        head = bone.head.copy()
        tail = bone.tail.copy()

        # Apply correction to the bone's rest rotation
        old_rot = bone.rotation_quaternion.copy()
        new_rot = correction @ old_rot
        bone.rotation_quaternion = new_rot

        # For edit bones, we need to rotate the actual coordinates.
        # Re-derive head/tail from the matrix.
        # The bone matrix = Translation(head) @ Rotation Quaternion @ Scale
        # We rotate the direction (tail - head) by the correction.
        direction = tail - head
        rotated_direction = correction.to_matrix() @ direction
        bone.tail = head + rotated_direction

        print(f"  fixed {bone_name}: {old_rot.degrees} -> {new_rot.degrees}")
        edited += 1

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"Done: edited {edited} bone(s)")


if __name__ == "__main__":
    fix_upper_arms()
