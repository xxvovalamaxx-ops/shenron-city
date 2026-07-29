"""Fetch the reviewed CC0 source pack used by the Shenron meadow scene.

This script intentionally uses Poly Haven's public API instead of scraping the
website. Source files stay under the ignored Raw tree; the generated receipt is
safe to commit and gives future artists an exact, verifiable restore recipe.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_ROOT = "https://api.polyhaven.com"
USER_AGENT = (
    "ShenronCityAssetCurator/0.1 "
    "(+https://github.com/xxvovalamaxx-ops/shenron-city)"
)

# A coherent temperate/pine-floor biome. Adding unrelated packs usually makes
# a scene less believable, even when every individual asset is photorealistic.
MODEL_ASSET_IDS = (
    "forest_ground_04",
    "brown_mud_leaves_01",
    "grass_bermuda_01",
    "grass_medium_01",
    "grass_medium_02",
    "fern_02",
    "nettle_plant",
    "weed_plant_02",
    "moss_01",
    "dry_branches_medium_01",
    "rock_moss_set_01",
    "pine_sapling_small",
    "pine_sapling_medium",
    "pine_tree_01",
    "tree_small_02",
    "jacaranda_tree",
    "island_tree_01",
    "island_tree_02",
)
HDRI_ID = "autumn_field_puresky"

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
RAW_ROOT = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Raw"
    / "Verified"
    / "PolyHaven"
)
RECEIPT_PATH = (
    REPO_ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "polyhaven-meadow-receipt.json"
)


def request_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": "https://github.com/xxvovalamaxx-ops/shenron-city",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_file(
    descriptor: dict[str, Any],
    target_dir: Path,
    relative_name: str | None = None,
) -> dict[str, Any]:
    url = descriptor["url"]
    expected_md5 = descriptor["md5"].lower()
    url_filename = Path(
        urllib.parse.unquote(urllib.parse.urlparse(url).path)
    ).name
    relative_path = Path(relative_name) if relative_name else Path(url_filename)
    target = target_dir / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists() and md5(target) == expected_md5:
        status = "cached"
    else:
        # Version 1 of this script flattened dependency paths. Migrate those
        # already-verified local files instead of redownloading them.
        legacy = target_dir / url_filename
        if (
            relative_name
            and legacy != target
            and legacy.exists()
            and md5(legacy) == expected_md5
        ):
            legacy.replace(target)
            status = "migrated"
            return {
                "filename": relative_path.as_posix(),
                "url": url,
                "md5": expected_md5,
                "size": target.stat().st_size,
                "status": status,
            }
        temporary = target.with_suffix(target.suffix + ".part")
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Referer": "https://polyhaven.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=180) as response:
            with temporary.open("wb") as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
        actual_md5 = md5(temporary)
        if actual_md5 != expected_md5:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(
                f"Checksum mismatch for {relative_path.as_posix()}: "
                f"expected {expected_md5}, received {actual_md5}"
            )
        temporary.replace(target)
        status = "downloaded"

    return {
        "filename": relative_path.as_posix(),
        "url": url,
        "md5": expected_md5,
        "size": target.stat().st_size,
        "status": status,
    }


def main() -> None:
    RAW_ROOT.mkdir(parents=True, exist_ok=True)
    receipt: dict[str, Any] = {
        "schemaVersion": 2,
        "source": "Poly Haven public API",
        "api": API_ROOT,
        "license": "CC0-1.0",
        "licenseUrl": "https://polyhaven.com/license",
        "variants": {
            "models": {"resolution": "1k", "format": "blend"},
            "lighting": {"resolution": "2k", "format": "hdr"},
        },
        "assets": [],
    }

    total_assets = len(MODEL_ASSET_IDS) + 1
    for index, asset_id in enumerate(MODEL_ASSET_IDS, start=1):
        print(f"[{index}/{total_assets}] {asset_id}")
        info = request_json(f"{API_ROOT}/info/{asset_id}")
        files = request_json(f"{API_ROOT}/files/{asset_id}")
        try:
            root_descriptor = files["blend"]["1k"]["blend"]
        except KeyError as error:
            raise RuntimeError(
                f"{asset_id} does not expose the expected 1K Blender source"
            ) from error

        target_dir = RAW_ROOT / asset_id
        target_dir.mkdir(parents=True, exist_ok=True)

        downloaded = [download_file(root_descriptor, target_dir)]
        downloaded.extend(
            download_file(descriptor, target_dir, relative_name)
            for relative_name, descriptor
            in root_descriptor.get("include", {}).items()
        )
        receipt["assets"].append(
            {
                "id": asset_id,
                "kind": "model",
                "variant": "1k-blend",
                "name": info["name"],
                "authors": sorted(info.get("authors", {}).keys()),
                "page": f"https://polyhaven.com/a/{asset_id}",
                "files": downloaded,
            }
        )
        # Stay deliberately gentle with the free public API.
        time.sleep(0.25)

    print(f"[{total_assets}/{total_assets}] {HDRI_ID}")
    hdri_info = request_json(f"{API_ROOT}/info/{HDRI_ID}")
    hdri_files = request_json(f"{API_ROOT}/files/{HDRI_ID}")
    try:
        hdri_descriptor = hdri_files["hdri"]["2k"]["hdr"]
    except KeyError as error:
        raise RuntimeError(
            f"{HDRI_ID} does not expose the expected 2K HDR source"
        ) from error
    hdri_target = RAW_ROOT / HDRI_ID
    hdri_target.mkdir(parents=True, exist_ok=True)
    receipt["assets"].append(
        {
            "id": HDRI_ID,
            "kind": "hdri",
            "variant": "2k-hdr",
            "name": hdri_info["name"],
            "authors": sorted(hdri_info.get("authors", {}).keys()),
            "page": f"https://polyhaven.com/a/{HDRI_ID}",
            "files": [download_file(hdri_descriptor, hdri_target)],
        }
    )

    RECEIPT_PATH.write_text(
        json.dumps(receipt, indent=2) + "\n",
        encoding="utf-8",
    )
    total_bytes = sum(
        file["size"]
        for asset in receipt["assets"]
        for file in asset["files"]
    )
    print(
        f"Verified {len(receipt['assets'])} CC0 assets "
        f"({total_bytes / 1024 / 1024:.1f} MiB)."
    )
    print(f"Receipt: {RECEIPT_PATH}")


if __name__ == "__main__":
    main()
