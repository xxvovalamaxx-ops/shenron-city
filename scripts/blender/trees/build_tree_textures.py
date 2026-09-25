"""Compose the tree textures: leaf-cluster atlas and bark maps.

    python3 scripts/blender/trees/fetch_polyhaven.py /tmp/ph
    python3 scripts/blender/trees/build_tree_textures.py /tmp/ph public/textures/nature/trees

Runs under Blender's Python module (bpy is only used for image I/O; the
compositing is numpy). Deterministic: every random draw comes from a seeded
generator.

leaf-atlas.webp (2048 x 1024, RGBA, sRGB) is a 4 x 2 grid of 512 px cells.
Each cell is a leafy twig seen flat — a "cluster card" the tree generator
(src/world/life/tree-gen.ts) scatters through a crown:

    0 plane    palmate, maple-like leaves (London plane)
    1 elm      small elliptic leaves, dense (American elm, generic park)
    2 locust   fine compound leaves (honey locust)
    3 ginkgo   small fans on short spurs (ginkgo, pear)
    4 pine     fir/pine sprigs
    5 oak      pinnately lobed leaves (pin oak)
    6 clump    a dense leaf mass for the mid-distance cards
    7 pineclump dense needles for mid-distance conifers

Leaf shapes are either the CC0 Poly Haven photo leaves (single leaves from
island_tree_01, compound sprigs from jacaranda_tree, twigs from fir_tree_01),
or procedural silhouettes (palmate, lobed, fan) filled with the photo leaves'
own texture so they share the same lighting and grain.

Colour is bled into transparent texels so mipmaps do not grow dark fringes.
"""
import math
import os
import sys

import bpy
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else 'polyhaven'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/textures/nature/trees'
CELL = 512
rng = np.random.default_rng(20260924)


# ---------------------------------------------------------------- image io

def load(name, channels=4):
    im = bpy.data.images.load(os.path.join(SRC, name))
    w, h = im.size
    px = np.array(im.pixels[:], np.float32).reshape(h, w, im.channels)[::-1]
    if px.shape[2] == 3:
        px = np.concatenate([px, np.ones((h, w, 1), np.float32)], 2)
    return px[..., :channels].copy()


def save(arr, name, quality=90, size=None):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=arr.shape[2] == 4)
    rgba = arr if arr.shape[2] == 4 else np.concatenate([arr, np.ones((h, w, 1), np.float32)], 2)
    img.pixels = np.ascontiguousarray(rgba[::-1]).ravel()
    if size:
        img.scale(*size)
    scene = bpy.context.scene
    st = scene.render.image_settings
    st.file_format = 'WEBP'
    st.color_mode = 'RGBA' if arr.shape[2] == 4 else 'RGB'
    st.quality = quality
    path = os.path.join(OUT, name)
    img.save_render(path, scene=scene)
    print('wrote', path, os.path.getsize(path))


# ---------------------------------------------------------------- sprites

def runs(mask1d):
    out = []
    start = None
    for i, v in enumerate(mask1d):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(mask1d)))
    return out


def xy_cut(mask, r0, r1, c0, c1, depth=0, out=None):
    """Recursive projection split: bounding boxes of separated shapes."""
    if out is None:
        out = []
    sub = mask[r0:r1, c0:c1]
    rr = runs(sub.any(1))
    cc = runs(sub.any(0))
    if not rr or not cc:
        return out
    if len(rr) == 1 and len(cc) == 1:
        out.append((r0 + rr[0][0], r0 + rr[0][1], c0 + cc[0][0], c0 + cc[0][1]))
        return out
    if len(rr) > 1:
        for a, b in rr:
            xy_cut(mask, r0 + a, r0 + b, c0, c1, depth + 1, out)
    else:
        for a, b in cc:
            xy_cut(mask, r0, r1, c0 + a, c0 + b, depth + 1, out)
    return out


def components(mask, step=4):
    """Connected components of a boolean mask, labelled on a 1/step grid.

    Returns bounding boxes (r0, r1, c0, c1) in full-resolution pixels. Plain
    BFS: the grid is at most 256 x 256.
    """
    small = mask[::step, ::step]
    h, w = small.shape
    label = np.zeros((h, w), np.int32)
    boxes = []
    n = 0
    for y in range(h):
        for x in range(w):
            if not small[y, x] or label[y, x]:
                continue
            n += 1
            label[y, x] = n
            stack = [(y, x)]
            r0, r1, c0, c1 = y, y, x, x
            while stack:
                cy, cx = stack.pop()
                r0, r1, c0, c1 = min(r0, cy), max(r1, cy), min(c0, cx), max(c1, cx)
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = n
                        stack.append((ny, nx))
            boxes.append((r0 * step, min(mask.shape[0], (r1 + 1) * step),
                          c0 * step, min(mask.shape[1], (c1 + 1) * step)))
    return boxes


def normalise(spr, target):
    """Rescale a sprite's colour so its mean (over opaque texels) is `target`.

    The photo leaves were shot dark; every species tints from the same
    well-exposed base instead.
    """
    a = spr[..., 3] > 0.5
    if not a.any():
        return spr
    mean = spr[..., :3][a].mean(0)
    out = spr.copy()
    out[..., :3] = np.clip(spr[..., :3] / np.maximum(mean, 1e-3) * np.array(target, np.float32), 0, 1)
    return out


LEAF_BASE = (0.36, 0.46, 0.20)   # sRGB, a sunlit mid-summer green


def sprites(diff, alpha, min_px=40, max_frac=0.6):
    rgba = diff.copy()
    rgba[..., 3] = alpha[..., 0]
    mask = alpha[..., 0] > 0.5
    H, W = mask.shape
    out = []
    for r0, r1, c0, c1 in components(mask):
        if (r1 - r0) < min_px or (c1 - c0) < min_px:
            continue
        # a region spanning most of the sheet is a bark/branch strip, not a leaf
        if (r1 - r0) > H * max_frac and (c1 - c0) > W * max_frac:
            continue
        # a strip hugging the sheet edge is the trunk section of a twig sheet
        if (c1 - c0) > W * 0.7 or (r1 - r0) > H * 0.9:
            continue
        spr = rgba[r0:r1, c0:c1].copy()
        # keep only this component's pixels: neighbours' leaves can poke into
        # the bounding box
        out.append(normalise(spr, LEAF_BASE))
    return out


def stamp(dst, spr, cx, cy, length, angle, tint=(1, 1, 1), shade=1.0):
    """Draw `spr` centred at (cx, cy), its long (vertical) axis `length` px,
    rotated by `angle` (radians, 0 = sprite up is canvas up)."""
    sh, sw = spr.shape[:2]
    s = length / sh
    ca, sa = math.cos(angle), math.sin(angle)
    hw, hh = sw * s / 2, sh * s / 2
    ext = math.hypot(hw, hh)
    H, W = dst.shape[:2]
    x0, x1 = int(max(0, cx - ext)), int(min(W, cx + ext + 1))
    y0, y1 = int(max(0, cy - ext)), int(min(H, cy + ext + 1))
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx, dy = xs - cx, ys - cy
    # canvas y grows downward; sprite rows too
    u = (dx * ca + dy * sa) / s + sw / 2
    v = (-dx * sa + dy * ca) / s + sh / 2
    ok = (u >= 0) & (u < sw - 1) & (v >= 0) & (v < sh - 1)
    if not ok.any():
        return
    u = np.clip(u, 0, sw - 1.001)
    v = np.clip(v, 0, sh - 1.001)
    iu, iv = u.astype(np.int32), v.astype(np.int32)
    fu, fv = (u - iu)[..., None], (v - iv)[..., None]
    c = (spr[iv, iu] * (1 - fu) * (1 - fv) + spr[iv, iu + 1] * fu * (1 - fv)
         + spr[iv + 1, iu] * (1 - fu) * fv + spr[iv + 1, iu + 1] * fu * fv)
    a = c[..., 3:4] * ok[..., None]
    rgb = c[..., :3] * np.array(tint, np.float32) * shade
    reg = dst[y0:y1, x0:x1]
    da = reg[..., 3:4]
    oa = a + da * (1 - a)
    reg[..., :3] = np.where(oa > 1e-5, (rgb * a + reg[..., :3] * da * (1 - a)) / np.maximum(oa, 1e-5), reg[..., :3])
    reg[..., 3:4] = oa


def line(dst, pts, width, color):
    """A tapered stem through `pts` (canvas px), drawn as overlapping discs."""
    H, W = dst.shape[:2]
    for i in range(len(pts) - 1):
        (xa, ya), (xb, yb) = pts[i], pts[i + 1]
        n = int(max(2, math.hypot(xb - xa, yb - ya)))
        for k in range(n):
            t = k / n
            x, y = xa + (xb - xa) * t, ya + (yb - ya) * t
            wv = width * (1 - 0.6 * (i + t) / len(pts))
            r = max(0.8, wv / 2)
            x0, x1 = int(max(0, x - r - 1)), int(min(W, x + r + 2))
            y0, y1 = int(max(0, y - r - 1)), int(min(H, y + r + 2))
            if x1 <= x0 or y1 <= y0:
                continue
            ys, xs = np.mgrid[y0:y1, x0:x1]
            d = np.hypot(xs - x, ys - y)
            a = np.clip(r + 0.5 - d, 0, 1)[..., None]
            reg = dst[y0:y1, x0:x1]
            reg[..., :3] = reg[..., :3] * (1 - a) + np.array(color, np.float32) * a
            reg[..., 3:4] = np.maximum(reg[..., 3:4], a)


# ------------------------------------------------------ procedural leaves

def leaf_from_mask(mask, veins, texture):
    """RGBA sprite: `mask` (h, w) in 0..1, filled with a photo leaf texture."""
    h, w = mask.shape
    th, tw = texture.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    tu = np.clip((xs / w) * (tw - 1), 0, tw - 1).astype(np.int32)
    tv = np.clip((ys / h) * (th - 1), 0, th - 1).astype(np.int32)
    rgb = texture[tv, tu, :3].copy()
    if veins is not None:
        rgb *= (1 - 0.35 * veins[..., None])
    return np.concatenate([rgb, mask[..., None]], 2).astype(np.float32)


def palmate(size=256, lobes=5, spread=1.25, seed=0):
    """Maple / plane leaf: pointed lobes radiating from the petiole."""
    r = np.random.default_rng(seed)
    h = w = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    bx, by = w / 2, h * 0.78
    mask = np.zeros((h, w), np.float32)
    veins = np.zeros((h, w), np.float32)
    for i in range(lobes):
        t = i / (lobes - 1) - 0.5
        ang = t * spread * 2
        L = h * (0.72 - 0.28 * abs(t) * 2) * (0.92 + 0.12 * r.random())
        dx, dy = math.sin(ang), -math.cos(ang)
        px, py = xs - bx, ys - by
        along = px * dx + py * dy
        across = np.abs(-px * dy + py * dx)
        tt = np.clip(along / L, 0, 1)
        width = L * 0.34 * np.maximum(np.sin(np.pi * tt), 0) ** 0.7 * np.maximum(1 - tt, 0) ** 0.25
        inside = (along > -h * 0.03) & (along < L) & (across < width)
        mask = np.maximum(mask, inside.astype(np.float32))
        veins = np.maximum(veins, ((across < 1.4) & (along > 0) & (along < L * 0.9)).astype(np.float32))
    # petiole
    stem = (np.abs(xs - bx) < 2.2) & (ys > by) & (ys < h * 0.99)
    mask = np.maximum(mask, stem.astype(np.float32))
    return mask, veins


def lobed(size=256, lobes=4, seed=0):
    """Oak leaf: an elongated blade with rounded or bristle-tipped lobes."""
    r = np.random.default_rng(seed)
    h, w = size, int(size * 0.62)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    t = 1 - ys / h                      # 0 at base, 1 at tip
    base = np.sin(np.pi * np.clip((t - 0.06) / 0.94, 0, 1)) ** 0.8
    wav = 0.55 + 0.45 * np.abs(np.sin(np.pi * lobes * t + r.random()))
    half = (w * 0.48) * base * wav
    mask = (np.abs(xs - w / 2) < half).astype(np.float32)
    stem = (np.abs(xs - w / 2) < 2.0) & (t < 0.1)
    mask = np.maximum(mask, stem.astype(np.float32))
    veins = (np.abs(xs - w / 2) < 1.3).astype(np.float32) * (t > 0.05)
    return mask, veins


def fan(size=128, seed=0):
    """Ginkgo: a notched fan on a thin stalk."""
    h = w = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    bx, by = w / 2, h * 0.92
    dx, dy = xs - bx, by - ys
    rr = np.hypot(dx, dy)
    ang = np.arctan2(dx, dy)
    outer = h * (0.78 + 0.04 * np.sin(ang * 9))
    inside = (rr < outer) & (rr > h * 0.1) & (np.abs(ang) < 0.95)
    notch = (np.abs(ang) < 0.05) & (rr > outer * 0.72)
    stem = (np.abs(dx) < 1.6) & (dy >= 0) & (rr <= h * 0.14)
    mask = ((inside & ~notch) | stem).astype(np.float32)
    veins = ((np.abs(np.sin(ang * 14)) < 0.12) & inside).astype(np.float32) * 0.5
    return mask, veins


# ---------------------------------------------------------------- cells

GREENS = {
    'plane': (0.78, 1.0, 0.62),
    'elm': (0.82, 1.0, 0.70),
    'locust': (1.08, 1.12, 0.62),
    'ginkgo': (1.02, 1.08, 0.56),
    'pine': (0.78, 0.92, 0.80),
    'oak': (0.74, 0.92, 0.62),
}


def jitter(base, amount=0.12):
    j = 1 + (rng.random(3) - 0.5) * 2 * amount
    return tuple(float(b * x) for b, x in zip(base, j))


def twig_cell(leaves, n_twigs, per_twig, leaf_len, green, stem_color=(0.23, 0.17, 0.11),
              spread=0.9, droop=0.0, fill=0):
    """A branching twig with leaves along each side shoot."""
    cell = np.zeros((CELL, CELL, 4), np.float32)
    base = (CELL * 0.5, CELL * 0.98)
    tip = (CELL * (0.5 + (rng.random() - 0.5) * 0.1), CELL * 0.16)
    main = [base, ((base[0] + tip[0]) / 2 + (rng.random() - 0.5) * 30, CELL * 0.5), tip]
    shoots = []
    for i in range(n_twigs):
        t = 0.18 + 0.78 * (i + rng.random() * 0.6) / n_twigs
        sx = base[0] + (tip[0] - base[0]) * t
        sy = base[1] + (tip[1] - base[1]) * t
        side = -1 if i % 2 == 0 else 1
        ang = side * (0.5 + rng.random() * spread) - droop * side
        L = CELL * (0.20 + 0.22 * (1 - abs(t - 0.45)) * rng.random() + 0.08)
        ex = sx + math.sin(ang) * L
        ey = sy - math.cos(ang) * L
        shoots.append(((sx, sy), (ex, ey), ang))
    line(cell, main, 6.0, stem_color)
    for (s, e, _) in shoots:
        line(cell, [s, ((s[0] + e[0]) / 2, (s[1] + e[1]) / 2 + 6), e], 3.2, stem_color)
    # leaves: along shoots, outward, big ones first so small ones sit on top
    placements = []
    for (s, e, ang) in shoots + [((base[0], base[1] - CELL * 0.35), tip, 0.0)]:
        for k in range(per_twig):
            t = 0.25 + 0.75 * (k + rng.random() * 0.5) / per_twig
            px = s[0] + (e[0] - s[0]) * t
            py = s[1] + (e[1] - s[1]) * t
            side = 1 if k % 2 else -1
            a = ang + side * (0.55 + rng.random() * 0.6)
            L = leaf_len * (0.75 + 0.5 * rng.random()) * (0.85 + 0.3 * t)
            cx = px + math.sin(a) * L * 0.45
            cy = py - math.cos(a) * L * 0.45
            placements.append((cx, cy, L, a))
        # terminal leaf
        L = leaf_len * (0.9 + 0.3 * rng.random())
        placements.append((e[0] + math.sin(ang) * L * 0.4, e[1] - math.cos(ang) * L * 0.4, L, ang))
    for _ in range(fill):
        cx = CELL * (0.15 + 0.7 * rng.random())
        cy = CELL * (0.1 + 0.75 * rng.random())
        placements.append((cx, cy, leaf_len * (0.8 + 0.4 * rng.random()), rng.random() * 6.28))
    rng.shuffle(placements)
    for (cx, cy, L, a) in placements:
        # keep every leaf whole inside its cell: a leaf cut by the cell edge
        # shows as a straight line on the card
        m = L * 0.5 + 4
        cx = min(max(cx, m), CELL - m)
        cy = min(max(cy, m), CELL - m)
        spr = leaves[rng.integers(len(leaves))]
        shade = 0.72 + 0.4 * rng.random()
        stamp(cell, spr, cx, cy, L, a, jitter(green), shade)
    return cell


def sprig_cell(sprigs, count, length, green, fill_ratio=0.0):
    """Whole photo sprigs (compound leaves, fir twigs) fanned from the base."""
    cell = np.zeros((CELL, CELL, 4), np.float32)
    for i in range(count):
        t = (i + 0.5) / count
        a = (t - 0.5) * 2.2 + (rng.random() - 0.5) * 0.3
        L = length * (0.8 + 0.35 * rng.random())
        r = L * 0.5 + CELL * 0.04 * rng.random()
        cx = CELL / 2 + math.sin(a) * r * 0.9
        cy = CELL * 0.92 - math.cos(a) * r * 0.9
        m = L * 0.5 + 4
        cx = min(max(cx, m), CELL - m)
        cy = min(max(cy, m), CELL - m)
        spr = sprigs[rng.integers(len(sprigs))]
        stamp(cell, spr, cx, cy, L, a, jitter(green, 0.08), 0.8 + 0.3 * rng.random())
    for _ in range(int(count * fill_ratio)):
        cx = CELL * (0.2 + 0.6 * rng.random())
        cy = CELL * (0.15 + 0.6 * rng.random())
        spr = sprigs[rng.integers(len(sprigs))]
        L = length * 0.7
        m = L * 0.5 + 4
        cx = min(max(cx, m), CELL - m)
        cy = min(max(cy, m), CELL - m)
        stamp(cell, spr, cx, cy, L, rng.random() * 6.28, jitter(green, 0.08), 0.75 + 0.3 * rng.random())
    return cell


def bleed(img, steps=12):
    """Push colour outward into transparent texels (no dark mip fringes)."""
    rgb = img[..., :3].copy()
    a = img[..., 3] > 0.02
    filled = a.copy()
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_f = np.roll(filled, (dy, dx), (0, 1))
            sh_c = np.roll(rgb, (dy, dx), (0, 1))
            acc += sh_c * sh_f[..., None]
            cnt += sh_f
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    # whatever is still empty takes the average leaf colour
    if (~filled).any() and filled.any():
        rgb[~filled] = rgb[filled].mean(0)
    out = img.copy()
    out[..., :3] = rgb
    return out


def build_atlas():
    isl = load('island_tree_01_leaves_diff_1k.png')
    isl_a = load('island_tree_01_leaves_alpha_1k.png')
    jac = load('jacaranda_tree_leaves_diff_1k.png')
    jac_a = load('jacaranda_tree_leaves_alpha_1k.png')
    fir = load('fir_tree_01_twig_diff_1k.png')
    fir_a = load('fir_tree_01_twig_alpha_1k.png')

    singles = sprites(isl, isl_a, 60)
    compound = sprites(jac, jac_a, 120)
    firs = [s for s in sprites(fir, fir_a, 80) if s.shape[0] > 100]
    print('sprites: singles', len(singles), 'compound', len(compound), 'fir', len(firs))

    # photo leaf used as the fill texture for procedural silhouettes: the
    # widest single leaf, cropped to its interior
    tex = max(singles, key=lambda s: s.shape[1])
    th, tw = tex.shape[:2]
    tex = tex[int(th * 0.2):int(th * 0.8), int(tw * 0.25):int(tw * 0.75)]

    plane_leaves = [leaf_from_mask(*palmate(256, 5, 1.2 + 0.1 * i, seed=i), texture=tex) for i in range(4)]
    oak_leaves = [leaf_from_mask(*lobed(256, 3 + i % 2, seed=i), texture=tex) for i in range(4)]
    fans = [leaf_from_mask(*fan(128, seed=i), texture=tex) for i in range(3)]

    atlas = np.zeros((CELL * 2, CELL * 4, 4), np.float32)
    cells = [
        twig_cell(plane_leaves, 5, 4, 112, GREENS['plane'], fill=6),
        twig_cell(singles, 8, 6, 66, GREENS['elm'], spread=0.8, fill=18),
        sprig_cell(compound, 7, CELL * 0.5, GREENS['locust'], fill_ratio=0.4),
        twig_cell(fans, 7, 7, 48, GREENS['ginkgo'], spread=0.7, fill=16),
        sprig_cell(firs, 8, CELL * 0.52, GREENS['pine'], fill_ratio=0.5),
        twig_cell(oak_leaves, 5, 4, 100, GREENS['oak'], fill=6),
        twig_cell(singles, 8, 6, 78, GREENS['elm'], spread=1.1, fill=46),
        sprig_cell(firs, 9, CELL * 0.52, GREENS['pine'], fill_ratio=1.4),
    ]
    for i, c in enumerate(cells):
        r, col = divmod(i, 4)
        atlas[r * CELL:(r + 1) * CELL, col * CELL:(col + 1) * CELL] = c
    atlas = bleed(atlas)
    atlas[..., 3] = np.clip(atlas[..., 3], 0, 1)
    save(atlas, 'leaf-atlas.webp', quality=92)


def build_bark():
    for src, name in (('bark_brown_02', 'bark-broadleaf'), ('pine_bark', 'pine-bark')):
        d = load(f'{src}_diff_1k.jpg', 3)
        n = load(f'{src}_nor_gl_1k.jpg', 3)
        save(d, f'{name}.webp', quality=88)
        save(n, f'{name}-normal.webp', quality=92)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    build_atlas()
    build_bark()
