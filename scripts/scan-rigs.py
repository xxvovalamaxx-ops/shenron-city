import bpy
import json
import os

JOBS = [
    ("quaternius", "E:/temp projects/shenron-city/public/models/characters/quaternius-hero/quaternius-hero.glb"),
    ("tp_male", "E:/temp projects/shenron-city/SourceAssets/PublicLibrary/Characters/Sketchfab/Rigged_T_Pose_Male_Blendshapes.glb"),
    ("alina", "E:/temp projects/shenron-city/SourceAssets/PublicLibrary/Characters/Sketchfab/alina_ip_realistic_asian_woman_animated.glb"),
    ("eric", "E:/temp projects/shenron-city/SourceAssets/PublicLibrary/Characters/Sketchfab/Eric_Rigged_Business_Man.glb"),
]
OUT = {}
for name, path in JOBS:
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=path)
        arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
        bones = []
        for a in arms:
            for b in a.data.bones:
                bones.append(b.name)
        # dedupe preserving order
        seen = set()
        bones = [b for b in bones if not (b in seen or seen.add(b))]
        clip_names = [a.name for a in bpy.data.actions]
        OUT[name] = {"boneCount": len(bones), "bones": bones[:70], "clips": clip_names[:10]}
        print("OK", name, len(bones), flush=True)
    except Exception as e:
        OUT[name] = {"error": repr(e)}
        print("ERR", name, repr(e)[:120], flush=True)

with open("E:/temp projects/shenron-city/scripts/rig-scan.json", "w") as fh:
    json.dump(OUT, fh, indent=1, default=str)
print("DONE")
