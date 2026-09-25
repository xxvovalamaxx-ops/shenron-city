"""Pack the city surface textures into two texture-array strips.

    python3 scripts/blender/pack_surface_textures.py [cache_dir]

The facade and street shaders sample every material from ONE pair of
texture arrays (albedo, and normal+roughness), so the whole city costs two
samplers however many materials it shows. WebGL2 uploads a texture array
straight from an image whose slices are stacked vertically, so each array
ships as a single tall strip: layer 0 on top.

  surface_albedo.jpg     1024 x (1024 * N)  sRGB albedo with AO multiplied in
  surface_nrm_rough.png   512 x ( 512 * N)  R,G = OpenGL normal XY, B = roughness

The normal/roughness strip is lossless PNG at half resolution: JPEG's chroma
subsampling bleeds the three packed channels into one another, and normal
detail past 512 px on a 2-3 m tile is below a pixel at street range anyway.

Sources are Poly Haven CC0 (https://polyhaven.com/license), downloaded at 1k.
Needs Blender as a Python module (`import bpy`) for image IO and numpy.
It also prints each layer's mean albedo, which facade.js uses to re-tint a
layer to a building's palette colour without shifting its brightness.
"""
import json
import os
import subprocess
import sys

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'textures', 'surfaces')
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache', 'polyhaven')

# Order is the layer index the shaders use (SURFACE_LAYER in surfaces/).
LAYERS = [
    'brick_wall_001',        # 0 red / dark common brick
    'yellow_brick',          # 1 buff / white brick
    'sandstone_blocks_08',   # 2 limestone ashlar
    'concrete_wall_008',     # 3 concrete panel / cast stone
    'painted_metal_shutter',  # 4 roll-down shutter, painted metal
    'asphalt_02',            # 5 asphalt
    'concrete_pavement_02',  # 6 sidewalk flags
]
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'AO': 'ao'}
ALBEDO = 1024
DATA = 512


def fetch(asset):
    os.makedirs(CACHE, exist_ok=True)
    meta_path = os.path.join(CACHE, f'{asset}.json')
    if not os.path.exists(meta_path):
        subprocess.run(['curl', '-sf', '-o', meta_path,
                        f'https://api.polyhaven.com/files/{asset}'], check=True)
    files = json.load(open(meta_path))
    paths = {}
    for key, short in MAPS.items():
        path = os.path.join(CACHE, f'{asset}_{short}_1k.jpg')
        if not os.path.exists(path):
            url = files[key]['1k']['jpg']['url']
            subprocess.run(['curl', '-sf', '-o', path, url], check=True)
        paths[short] = path
    return paths


def load(path):
    """Raw 0..1 values, top row first, no colour management."""
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return np.flipud(px.reshape(h, w, 4))[:, :, :3]


def box_down(a, size):
    f = a.shape[0] // size
    if f == 1:
        return a
    return a.reshape(size, f, size, f, a.shape[2]).mean(axis=(1, 3))


def save(a, path, fmt):
    h, w = a.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(a, 0, 1)
    img.pixels.foreach_set(np.flipud(rgba).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = fmt
    settings.color_mode = 'RGB'
    if fmt == 'JPEG':
        settings.quality = 86
    else:
        settings.color_depth = '8'
        settings.compression = 100
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)


def main():
    os.makedirs(OUT, exist_ok=True)
    albedo_strip = []
    data_strip = []
    means = []
    for asset in LAYERS:
        p = fetch(asset)
        diff = load(p['diff'])
        ao = load(p['ao'])[:, :, :1]
        # AO softened: the full-strength cavity map doubles up with the
        # shader's own grime and reads as soot in every mortar joint.
        alb = diff * (0.45 + 0.55 * ao)
        albedo_strip.append(box_down(alb, ALBEDO))
        # mean in linear light, which is what the shader divides by
        lin = np.where(alb <= 0.04045, alb / 12.92, ((alb + 0.055) / 1.055) ** 2.4)
        means.append([round(float(v), 4) for v in lin.reshape(-1, 3).mean(axis=0)])
        nor = load(p['nor'])
        rough = load(p['rough'])[:, :, :1]
        data = np.concatenate([nor[:, :, :2], rough], axis=2)
        data_strip.append(box_down(data, DATA))
        print(asset, 'mean linear albedo', means[-1])
    save(np.concatenate(albedo_strip, axis=0), os.path.join(OUT, 'surface_albedo.jpg'), 'JPEG')
    save(np.concatenate(data_strip, axis=0), os.path.join(OUT, 'surface_nrm_rough.png'), 'PNG')
    print(json.dumps({'layers': LAYERS, 'meanLinearAlbedo': means}))


main()
