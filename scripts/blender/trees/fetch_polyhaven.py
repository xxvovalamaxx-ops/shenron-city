"""Fetch the CC0 Poly Haven sources the tree textures are built from.

    python3 scripts/blender/trees/fetch_polyhaven.py <out_dir>

Everything here is CC0 1.0 (https://polyhaven.com/license). Only 1k maps are
used; build_tree_textures.py composes them into the runtime atlases under
public/textures/nature/trees/.
"""
import os
import subprocess
import sys

BASE = 'https://dl.polyhaven.org/file/ph-assets'
FILES = {
    # bark: broadleaf (grey-brown, the plane/oak/elm stand-in) and pine
    'bark_brown_02_diff_1k.jpg': f'{BASE}/Textures/jpg/1k/bark_brown_02/bark_brown_02_diff_1k.jpg',
    'bark_brown_02_nor_gl_1k.jpg': f'{BASE}/Textures/jpg/1k/bark_brown_02/bark_brown_02_nor_gl_1k.jpg',
    'pine_bark_diff_1k.jpg': f'{BASE}/Textures/jpg/1k/pine_bark/pine_bark_diff_1k.jpg',
    'pine_bark_nor_gl_1k.jpg': f'{BASE}/Textures/jpg/1k/pine_bark/pine_bark_nor_gl_1k.jpg',
    # leaves: single broad leaves, compound (honey-locust-like) sprigs, fir twigs
    'island_tree_01_leaves_diff_1k.png': f'{BASE}/Models/png/1k/island_tree_01/island_tree_01_leaves_diff_1k.png',
    'island_tree_01_leaves_alpha_1k.png': f'{BASE}/Models/png/1k/island_tree_01/island_tree_01_leaves_alpha_1k.png',
    'jacaranda_tree_leaves_diff_1k.png': f'{BASE}/Models/png/1k/jacaranda_tree/jacaranda_tree_leaves_diff_1k.png',
    'jacaranda_tree_leaves_alpha_1k.png': f'{BASE}/Models/png/1k/jacaranda_tree/jacaranda_tree_leaves_alpha_1k.png',
    'fir_tree_01_twig_diff_1k.png': f'{BASE}/Models/png/1k/fir_tree_01/fir_tree_01_twig_diff_1k.png',
    'fir_tree_01_twig_alpha_1k.png': f'{BASE}/Models/png/1k/fir_tree_01/fir_tree_01_twig_alpha_1k.png',
}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'polyhaven'
    os.makedirs(out, exist_ok=True)
    for name, url in FILES.items():
        path = os.path.join(out, name)
        if not os.path.exists(path):
            subprocess.run(['curl', '-sL', '--max-time', '300', '-o', path, url], check=True)
        print(f'{name:40s} {os.path.getsize(path):>9d}')


if __name__ == '__main__':
    main()
