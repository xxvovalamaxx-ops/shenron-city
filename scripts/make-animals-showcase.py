import bpy
import os

base = r'E:\temp projects\shenron-city\SourceAssets\PublicLibrary\Animals'
out_path = r'E:\temp projects\shenron-city\SourceAssets\PublicLibrary\_Showcases\animals_showcase.blend'

glbs = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.glb'):
            glbs.append(os.path.join(root, f))

print(f"Found {len(glbs)} animal GLBs")

# Clear default objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Import all GLBs
imported = 0
for glb in glbs:
    try:
        bpy.ops.import_scene.gltf(filepath=glb)
        imported += 1
        print(f"  OK {os.path.basename(glb)}")
    except Exception as e:
        print(f"  FAILED {os.path.basename(glb)}: {e}")

print(f"Imported: {imported}")

# Arrange in grid
cols = 6
spacing = 4.0
parents = []
for o in bpy.data.objects:
    if o.parent is None and o.type not in ('LIGHT', 'CAMERA'):
        parents.append(o)

for i, obj in enumerate(parents):
    col = i % cols
    row = i // cols
    obj.location = (col * spacing, row * spacing, 0)

print(f"Arranged: {len(parents)}")

# Save
bpy.ops.wm.save_as_mainfile(filepath=out_path)
print(f"Saved: {out_path}")
