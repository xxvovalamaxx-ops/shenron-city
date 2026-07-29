"""Generate local, non-publishable shrine-reference comparison evidence."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


def load_rgb(path: Path, size: tuple[int, int] | None = None) -> Image.Image:
    image = Image.open(path).convert("RGB")
    if size is not None and image.size != size:
        image = image.resize(size, Image.Resampling.LANCZOS)
    return image


def display_metrics(image: Image.Image) -> dict[str, object]:
    rgb = np.asarray(image, dtype=np.float32) / 255.0
    luminance = (
        rgb[..., 0] * 0.2126
        + rgb[..., 1] * 0.7152
        + rgb[..., 2] * 0.0722
    )
    maximum = rgb.max(axis=2)
    minimum = rgb.min(axis=2)
    saturation = np.divide(
        maximum - minimum,
        maximum,
        out=np.zeros_like(maximum),
        where=maximum > 1e-6,
    )
    height, width = luminance.shape
    regional: list[list[float]] = []
    for row in range(3):
        regional_row: list[float] = []
        y0 = round(height * row / 3)
        y1 = round(height * (row + 1) / 3)
        for column in range(3):
            x0 = round(width * column / 3)
            x1 = round(width * (column + 1) / 3)
            regional_row.append(float(luminance[y0:y1, x0:x1].mean()))
        regional.append(regional_row)
    return {
        "dimensions": [width, height],
        "mean_luminance": float(luminance.mean()),
        "median_luminance": float(np.median(luminance)),
        "luminance_stddev": float(luminance.std()),
        "luminance_p05": float(np.percentile(luminance, 5)),
        "luminance_p95": float(np.percentile(luminance, 95)),
        "luminance_range_p05_p95": float(
            np.percentile(luminance, 95) - np.percentile(luminance, 5)
        ),
        "pixels_above_0_8_percent": float((luminance > 0.8).mean() * 100.0),
        "mean_saturation": float(saturation.mean()),
        "near_white_percent": float((luminance > 0.98).mean() * 100.0),
        "regional_luminance_3x3": regional,
    }


def side_by_side(left: Image.Image, right: Image.Image) -> Image.Image:
    output = Image.new("RGB", (left.width + right.width, max(left.height, right.height)))
    output.paste(left, (0, 0))
    output.paste(right, (left.width, 0))
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    current = load_rgb(args.current, (963, 538))
    reference = load_rgb(args.reference, (963, 538))

    current.save(args.output / "current-963x538.png")
    reference.save(args.output / "reference-963x538.png")
    Image.blend(current, reference, 0.5).save(args.output / "overlay-50-percent.png")
    difference = ImageChops.difference(current, reference)
    ImageEnhance.Contrast(difference).enhance(1.5).save(
        args.output / "difference-enhanced.png"
    )

    current_gray = ImageOps.grayscale(current)
    reference_gray = ImageOps.grayscale(reference)
    side_by_side(current_gray.convert("RGB"), reference_gray.convert("RGB")).save(
        args.output / "grayscale-side-by-side.png"
    )
    for radius in (8, 32):
        current_blur = current_gray.filter(ImageFilter.GaussianBlur(radius))
        reference_blur = reference_gray.filter(ImageFilter.GaussianBlur(radius))
        side_by_side(
            current_blur.convert("RGB"),
            reference_blur.convert("RGB"),
        ).save(args.output / f"blur-{radius}px-side-by-side.png")

    current_metrics = display_metrics(current)
    reference_metrics = display_metrics(reference)
    comparison = {
        "current": current_metrics,
        "reference": reference_metrics,
        "absolute_error": {
            key: abs(float(current_metrics[key]) - float(reference_metrics[key]))
            for key in (
                "mean_luminance",
                "median_luminance",
                "luminance_stddev",
                "luminance_p95",
                "luminance_range_p05_p95",
                "pixels_above_0_8_percent",
                "mean_saturation",
            )
        },
        "mean_absolute_pixel_error": float(
            np.abs(
                np.asarray(current, dtype=np.float32)
                - np.asarray(reference, dtype=np.float32)
            ).mean()
            / 255.0
        ),
        "root_mean_square_pixel_error": float(
            math.sqrt(
                np.square(
                    np.asarray(current, dtype=np.float32)
                    - np.asarray(reference, dtype=np.float32)
                ).mean()
            )
            / 255.0
        ),
    }
    (args.output / "metrics.json").write_text(
        json.dumps(comparison, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
