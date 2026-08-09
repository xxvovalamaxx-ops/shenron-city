"""Downscale Radiance HDR environment maps for the web runtime.

Poly Haven ships these at 4K, which is 24-26 MB each. That is fine for an
offline render and absurd for a browser: the game already ships one 1K night
HDR at 1.6 MB, and matching that budget is what makes it affordable to have an
environment map at every hour of the day rather than only at night.

Run headless, and deliberately so. Blender is shared with another session
(OPUS-021) and a `--background --factory-startup` process has its own
interpreter and its own empty scene -- it cannot see, touch or save the .blend
open in the GUI. Nothing here loads or writes a .blend at all.

Usage:
    blender --background --factory-startup --python scripts/assets/downscale-hdr.py -- \
        --out public/hdr --size 1024 SOURCE.hdr [SOURCE.hdr ...]

Arguments after the bare `--` are ours; everything before belongs to Blender.
"""

from __future__ import annotations

import argparse
import os
import sys

import bpy


def our_argv() -> list[str]:
    """Everything after Blender's `--` separator."""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def downscale(source: str, out_dir: str, width: int) -> tuple[str, int, int, int, int]:
    # Absolute, always. Blender resolves a relative image path against the open
    # .blend's directory rather than the process working directory, so a path
    # that `os.path.isfile` just confirmed still fails to load with "No such
    # file or directory" -- which reads as a missing asset rather than a
    # resolution rule.
    source = os.path.abspath(source)
    image = bpy.data.images.load(source, check_existing=False)
    try:
        source_width, source_height = image.size
        if source_width == 0 or source_height == 0:
            raise RuntimeError(f"{source}: image reports a zero dimension")

        # Equirectangular maps are 2:1. Deriving the height rather than assuming
        # it keeps a non-2:1 source from being silently stretched.
        height = max(1, round(width * source_height / source_width))

        if source_width > width:
            image.scale(width, height)

        # Radiance RGBE out, float in. `save_render` is the path that honours an
        # explicit format; `image.save()` would write whatever the source was.
        settings = bpy.context.scene.render.image_settings
        settings.file_format = "HDR"
        settings.color_mode = "RGB"

        name = os.path.splitext(os.path.basename(source))[0]
        # 4k in a filename that is no longer 4K would be a lie the next reader
        # has to disprove, so the suffix is rewritten to what was produced.
        for suffix in ("_4k", "_2k", "_1k", "_8k"):
            if name.endswith(suffix):
                name = name[: -len(suffix)]
                break
        target = os.path.abspath(os.path.join(out_dir, f"{name}_{width // 1024}k.hdr"))

        image.save_render(filepath=target, scene=bpy.context.scene)
        return target, source_width, source_height, width, height
    finally:
        bpy.data.images.remove(image)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args(our_argv())

    os.makedirs(args.out, exist_ok=True)
    failures = 0

    for source in args.sources:
        if not os.path.isfile(source):
            print(f"MISSING {source}", flush=True)
            failures += 1
            continue
        try:
            target, sw, sh, w, h = downscale(source, args.out, args.size)
        except Exception as error:  # noqa: BLE001 - one bad map must not stop the batch
            print(f"FAILED  {source}: {error}", flush=True)
            failures += 1
            continue

        before = os.path.getsize(source)
        after = os.path.getsize(target)
        print(
            f"OK      {os.path.basename(target)}  "
            f"{sw}x{sh} -> {w}x{h}  "
            f"{before / 1e6:.1f} MB -> {after / 1e6:.1f} MB",
            flush=True,
        )

    print(f"DONE {len(args.sources) - failures}/{len(args.sources)}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
