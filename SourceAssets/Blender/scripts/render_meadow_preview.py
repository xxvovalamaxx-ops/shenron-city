"""Render a saved meadow authoring file to an explicit review image."""

from __future__ import annotations

import os
from pathlib import Path

import bpy


output = os.environ.get("SHENRON_RENDER_OUTPUT")
if not output:
    raise RuntimeError("SHENRON_RENDER_OUTPUT must point to the preview PNG")

scale = int(os.environ.get("SHENRON_RENDER_SCALE", "100"))
if not 25 <= scale <= 100:
    raise ValueError("SHENRON_RENDER_SCALE must be between 25 and 100")

target = Path(output).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
bpy.context.scene.render.resolution_percentage = scale
bpy.context.scene.render.filepath = str(target)
bpy.context.scene.frame_set(74)
bpy.ops.render.render(write_still=True)
print(f"Rendered {scale}% preview: {target}")
