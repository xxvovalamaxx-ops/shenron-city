import bpy
import json

path = "E:/temp projects/shenron-city/public/models/manhattan/manhattan_base.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
out = []
count = 0
for o in meshes:
    me = o.data
    minc = [1e9, 1e9, 1e9]
    maxc = [-1e9, -1e9, -1e9]
    for v in me.vertices:
        w = o.matrix_world @ v.co
        for i in range(3):
            minc[i] = min(minc[i], w[i])
            maxc[i] = max(maxc[i], w[i])
    out.append({
        "name": o.name,
        "verts": len(me.vertices),
        "tris": sum(1 if len(p.vertices) == 3 else 2 for p in me.polygons) if me.polygons else 0,
        "min": [round(v, 1) for v in minc],
        "max": [round(v, 1) for v in maxc],
        "sizeY": round(maxc[1] - minc[1], 1),
    })
    count += 1

flat = [x for x in out if x["sizeY"] < 3]
tall = [x for x in out if x["sizeY"] >= 3]
print("meshes:", count, "flat:", len(flat), "tall:", len(tall))
for x in flat[:12]:
    print("FLAT", x["name"][:40], x["min"], x["max"])
for x in tall[:8]:
    print("TALL", x["name"][:40], x["min"], x["max"])
with open("E:/temp projects/shenron-city/scripts/base-probe.json", "w") as fh:
    json.dump({"flat": flat[:50], "tall": tall[:50]}, fh, indent=1)
print("DONE")
