import bpy
import os
import sys

# Args: [0]=script, [1]=base dir, [2]=out path, [3]=cols
base = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else ''
out_path = sys.argv[sys.argv.index('--') + 2] if '--' in sys.argv else ''
cols = int(sys.argv[sys.argv.index('--') + 3]) if '--' in sys.argv else 5

if not base or not out_path:
    print("MISSING ARGS")
    sys.exit(1)

glbs = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.endswith('.glb'):
            glbs.append(os.path.join(root, f))

print(f"Found {len(glbs)} GLBs in {base}")

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

imported = 0
failed = []
for glb in glbs:
    try:
        bpy.ops.import_scene.gltf(filepath=glb)
        imported += 1
    except Exception as e:
        failed.append(os.path.basename(glb))

print(f"Imported: {imported} / {len(glbs)}")
if failed:
    print(f"Failed ({len(failed)}): {failed[:20]}")

spacing = 3.0
parents = []
for o in bpy.data.objects:
    if o.parent is None and o.type not in ('LIGHT', 'CAMERA'):
        parents.append(o)

for i, obj in enumerate(parents):
    col = i % cols
    row = i // cols
    obj.location = (col * spacing, row * spacing, 0)

print(f"Arranged: {len(parents)}")

bpy.ops.wm.save_as_mainfile(filepath=out_path)
print(f"Saved: {out_path}")
