"""Build the reviewed Poly Haven meadow subset for the browser runtime.

The source library is intentionally ignored. This script verifies each source
against the committed Poly Haven receipt, converts only the maps referenced by
the game, and records exact SHA-256 output pins for CI.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
SOURCE_ROOT = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Raw"
    / "Verified"
    / "PolyHaven"
)
SOURCE_RECEIPT = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "polyhaven-meadow-receipt.json"
)
RUNTIME_RECEIPT = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "runtime-meadow-receipt.json"
)
RUNTIME_ROOT = REPO_ROOT / "public" / "textures" / "nature" / "meadow"


@dataclass(frozen=True)
class RuntimeMap:
    asset_id: str
    source_name: str
    output_name: str
    role: str
    quality: int = 88
    grade: str | None = None


RUNTIME_MAPS = (
    RuntimeMap(
        "forest_ground_04",
        "textures/forest_ground_04_diff_1k.jpg",
        "forest-ground-04-albedo.webp",
        "albedo",
        86,
    ),
    RuntimeMap(
        "forest_ground_04",
        "textures/forest_ground_04_nor_gl_1k.exr",
        "forest-ground-04-normal.webp",
        "normal",
        90,
    ),
    RuntimeMap(
        "forest_ground_04",
        "textures/forest_ground_04_rough_1k.exr",
        "forest-ground-04-roughness.webp",
        "roughness",
        88,
    ),
    RuntimeMap(
        "brown_mud_leaves_01",
        "textures/brown_mud_leaves_01_diff_1k.jpg",
        "brown-mud-leaves-01-albedo.webp",
        "albedo",
        86,
    ),
    RuntimeMap(
        "brown_mud_leaves_01",
        "textures/brown_mud_leaves_01_nor_gl_1k.exr",
        "brown-mud-leaves-01-normal.webp",
        "normal",
        90,
    ),
    RuntimeMap(
        "grass_medium_01",
        "textures/grass_medium_01_diff_1k.jpg",
        "grass-medium-01-albedo.webp",
        "albedo",
        86,
        "eq=brightness=0.14:saturation=1.16:gamma=1.04",
    ),
    RuntimeMap(
        "grass_medium_01",
        "textures/grass_medium_01_alpha_1k.png",
        "grass-medium-01-alpha.webp",
        "alpha",
        92,
    ),
    RuntimeMap(
        "fern_02",
        "textures/fern_02_diff_1k.jpg",
        "fern-02-albedo.webp",
        "albedo",
        86,
        "eq=brightness=0.14:saturation=1.16:gamma=1.04",
    ),
    RuntimeMap(
        "fern_02",
        "textures/fern_02_alpha_1k.png",
        "fern-02-alpha.webp",
        "alpha",
        92,
    ),
    RuntimeMap(
        "weed_plant_02",
        "textures/weed_plant_02_diff_1k.jpg",
        "weed-plant-02-albedo.webp",
        "albedo",
        86,
        "eq=brightness=0.14:saturation=1.12:gamma=1.04",
    ),
    RuntimeMap(
        "weed_plant_02",
        "textures/weed_plant_02_alpha_1k.png",
        "weed-plant-02-alpha.webp",
        "alpha",
        92,
    ),
)


def digest(path: Path, algorithm: str) -> str:
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def source_descriptors() -> dict[tuple[str, str], dict[str, object]]:
    receipt = json.loads(SOURCE_RECEIPT.read_text(encoding="utf-8"))
    return {
        (asset["id"], file["filename"]): file
        for asset in receipt["assets"]
        for file in asset["files"]
    }


def main() -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required to build runtime meadow textures")

    descriptors = source_descriptors()
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    outputs: list[dict[str, object]] = []

    for runtime_map in RUNTIME_MAPS:
        source = SOURCE_ROOT / runtime_map.asset_id / runtime_map.source_name
        descriptor = descriptors.get((runtime_map.asset_id, runtime_map.source_name))
        if descriptor is None:
            raise RuntimeError(
                f"{runtime_map.asset_id}/{runtime_map.source_name} is absent "
                "from the reviewed source receipt"
            )
        if not source.is_file():
            raise RuntimeError(f"Missing verified source: {source}")
        actual_md5 = digest(source, "md5")
        if actual_md5 != descriptor["md5"]:
            raise RuntimeError(
                f"MD5 mismatch for {source}: "
                f"expected {descriptor['md5']}, received {actual_md5}"
            )

        output = RUNTIME_ROOT / runtime_map.output_name
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-map_metadata",
                "-1",
                "-vf",
                (
                    "scale=1024:1024:flags=lanczos"
                    + (f",{runtime_map.grade}" if runtime_map.grade else "")
                ),
                "-c:v",
                "libwebp",
                "-q:v",
                str(runtime_map.quality),
                "-compression_level",
                "6",
                str(output),
            ],
            check=True,
        )
        if output.stat().st_size < 10_000:
            output.unlink(missing_ok=True)
            raise RuntimeError(
                f"Suspiciously small runtime output for {runtime_map.output_name}"
            )
        outputs.append(
            {
                "assetId": runtime_map.asset_id,
                "role": runtime_map.role,
                "source": runtime_map.source_name,
                "sourceMd5": actual_md5,
                "runtimePath": output.relative_to(REPO_ROOT).as_posix(),
                "runtimeSha256": digest(output, "sha256"),
                "bytes": output.stat().st_size,
                "width": 1024,
                "height": 1024,
                "format": "webp",
            }
        )
        print(f"{runtime_map.output_name}: {output.stat().st_size / 1024:.1f} KiB")

    RUNTIME_RECEIPT.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "sourceReceipt": SOURCE_RECEIPT.relative_to(REPO_ROOT).as_posix(),
                "license": "CC0-1.0",
                "generator": Path(__file__).relative_to(REPO_ROOT).as_posix(),
                "outputs": outputs,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    total_bytes = sum(int(item["bytes"]) for item in outputs)
    print(
        f"Built {len(outputs)} runtime maps "
        f"({total_bytes / 1024 / 1024:.2f} MiB)."
    )


if __name__ == "__main__":
    main()
