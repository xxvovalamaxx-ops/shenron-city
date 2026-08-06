import bpy
import json

JOBS = [
    ("quaternius", "E:/temp projects/shenron-city/public/models/characters/quaternius-hero/quaternius-hero.glb"),
    ("eric", "E:/temp projects/shenron-city/SourceAssets/PublicLibrary/Characters/Sketchfab/Eric_Rigged_Business_Man.glb"),
]
OUT = {}
for name, path in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    bones = []
    for a in arms:
        for b in a.data.bones:
            bones.append(b.name)
    OUT[name] = bones
    print("OK", name, len(bones), flush=True)

with open("E:/temp projects/shenron-city/scripts/bone-lists.json", "w") as fh:
    json.dump(OUT, fh, indent=1)
print("DONE")
