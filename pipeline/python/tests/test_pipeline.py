from __future__ import annotations

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from pipeline.python.city_pipeline.__main__ import main
from pipeline.python.city_pipeline.config import load_config
from pipeline.python.city_pipeline.glb import glb_building_ids, glb_position_bounds
from pipeline.python.city_pipeline.models import ContractError
from pipeline.python.city_pipeline.normalize import (
    normalize_geojson,
    normalized_document_sha256,
)
from pipeline.python.city_pipeline.output import publish_directory
from pipeline.python.city_pipeline.sources import load_source_lock, verify_source
from pipeline.python.city_pipeline.tiles import (
    gltf_y_up_bounds_to_tile_z_up,
    package_tiles,
    write_json,
)
from pipeline.python.city_pipeline.validate import validate_package


REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN = REPO_ROOT / "tests/fixtures/manhattan-phase1/generated"


def tree_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def build(output: Path) -> dict[str, object]:
    config = load_config(REPO_ROOT / "data/config/manhattan-hq.json")
    source = load_source_lock(
        REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT
    )["phase1-synthetic-buildings"]
    source_hash = verify_source(source)
    document, buildings = normalize_geojson(config, source)
    derivation_hash = normalized_document_sha256(document)

    def write_product(staging: Path) -> dict[str, object]:
        write_json(staging / "normalized/buildings.json", document)
        package_tiles(config, buildings, source, source_hash, derivation_hash, staging)
        return validate_package(staging, source_hash, derivation_hash)

    return publish_directory(output, write_product)


def run_cli(arguments: list[str]) -> tuple[int, str, str]:
    stdout = io.StringIO()
    stderr = io.StringIO()
    with redirect_stdout(stdout), redirect_stderr(stderr):
        result = main(arguments)
    return result, stdout.getvalue(), stderr.getvalue()


class PipelineTests(unittest.TestCase):
    def test_golden_fixture_is_valid_and_complete(self) -> None:
        config = load_config(REPO_ROOT / "data/config/manhattan-hq.json")
        source = load_source_lock(
            REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT
        )["phase1-synthetic-buildings"]
        document, _buildings = normalize_geojson(config, source)
        summary = validate_package(
            GOLDEN,
            "5ffab7c95bb6a12715636febb4ff62a2d8add52cd35d6907e3da82bfc1dc347a",
            normalized_document_sha256(document),
        )
        self.assertEqual(summary["status"], "valid")
        self.assertEqual(summary["buildings"], 6)
        self.assertEqual(summary["visualTiles"], 6)

    def test_build_is_byte_deterministic_against_golden_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            self.assertEqual(tree_hashes(output), tree_hashes(GOLDEN))

    def test_declared_bounds_fail_when_tightened_below_glb(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            path = output / "tileset.json"
            tileset = json.loads(path.read_text(encoding="utf-8"))
            tileset["root"]["children"][0]["boundingVolume"]["box"][3] = 0.0
            write_json(path, tileset)
            with self.assertRaisesRegex(ContractError, "exceeds its declared"):
                validate_package(output)

    def test_validator_rejects_raw_y_up_glb_bounds_in_a_z_up_tile_box(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            path = output / "tileset.json"
            tileset = json.loads(path.read_text(encoding="utf-8"))
            child = next(
                item
                for item in tileset["root"]["children"]
                if "fixture-hq" in glb_building_ids(
                    (output / item["content"]["uri"]).read_bytes()
                )
            )
            min_x, min_y, min_z, max_x, max_y, max_z = glb_position_bounds(
                (output / child["content"]["uri"]).read_bytes()
            )
            child["boundingVolume"]["box"] = [
                (min_x + max_x) / 2.0,
                (min_y + max_y) / 2.0,
                (min_z + max_z) / 2.0,
                (max_x - min_x) / 2.0,
                0.0,
                0.0,
                0.0,
                (max_y - min_y) / 2.0,
                0.0,
                0.0,
                0.0,
                (max_z - min_z) / 2.0,
            ]
            write_json(path, tileset)
            with self.assertRaisesRegex(ContractError, "exceeds its declared"):
                validate_package(output)

    def test_hq_ground_is_hq_local_and_composed_tileset_world_floor_is_root_y(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            normalized = json.loads((output / "normalized" / "buildings.json").read_text(encoding="utf-8"))
            hq = next(item for item in normalized["buildings"] if item["buildingId"] == "fixture-hq")
            self.assertAlmostEqual(hq["sourceGroundElevationMeters"], 12.000024, places=6)
            self.assertAlmostEqual(hq["groundElevationMeters"], 0.000024, places=6)

            tileset = json.loads((output / "tileset.json").read_text(encoding="utf-8"))
            root = tileset["root"]
            hq_child = next(
                child
                for child in root["children"]
                if "fixture-hq" in glb_building_ids(
                    (output / child["content"]["uri"]).read_bytes()
                )
            )
            glb_bounds = glb_position_bounds(
                (output / hq_child["content"]["uri"]).read_bytes()
            )
            tile_bounds = gltf_y_up_bounds_to_tile_z_up(glb_bounds)
            self.assertAlmostEqual(glb_bounds[1], hq["groundElevationMeters"], places=6)
            self.assertAlmostEqual(tile_bounds[2], glb_bounds[1], places=6)

            manifest = json.loads((output / "gameplay" / "manifest.json").read_text(encoding="utf-8"))
            hq_tile_id = hq_child["extras"]["tileId"]
            hq_manifest = next(item for item in manifest["tiles"] if item["tileId"] == hq_tile_id)
            collider = json.loads((output / "gameplay" / hq_manifest["collisionUri"]).read_text(encoding="utf-8"))
            hq_collider = next(item for item in collider["colliders"] if item["buildingId"] == "fixture-hq")
            self.assertAlmostEqual(hq_collider["minY"], glb_bounds[1], places=6)

            def transform_point(matrix: list[float], point: tuple[float, float, float]) -> tuple[float, float, float]:
                return tuple(
                    matrix[row] * point[0]
                    + matrix[4 + row] * point[1]
                    + matrix[8 + row] * point[2]
                    + matrix[12 + row]
                    for row in range(3)
                )  # type: ignore[return-value]

            tile_point = (tile_bounds[0], tile_bounds[1], tile_bounds[2])
            root_local = transform_point(hq_child["transform"], tile_point)
            world = transform_point(root["transform"], root_local)
            self.assertAlmostEqual(root["transform"][13], 12.0, places=9)
            self.assertAlmostEqual(world[1], 12.000024, places=6)

    def test_package_rederives_and_rejects_a_9999m_normalized_tamper(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            normalized = root / "normalized.json"
            result, _stdout, stderr = run_cli(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "normalize",
                    "--output",
                    str(normalized),
                ]
            )
            self.assertEqual(result, 0, stderr)
            document = json.loads(normalized.read_text(encoding="utf-8"))
            self.assertEqual(document["sourceId"], "phase1-synthetic-buildings")
            self.assertEqual(
                document["sourceSha256"],
                "5ffab7c95bb6a12715636febb4ff62a2d8add52cd35d6907e3da82bfc1dc347a",
            )
            document["buildings"][0]["groundElevationMeters"] = 9999.0
            write_json(normalized, document)
            output = root / "generated"
            output.mkdir()
            sentinel = output / "old-output.txt"
            sentinel.write_text("preserve me", encoding="utf-8")
            result, _stdout, stderr = run_cli(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "package-tiles",
                    "--normalized",
                    str(normalized),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(result, 2)
            self.assertIn("does not exactly match", stderr)
            self.assertTrue(sentinel.is_file())
            self.assertFalse((output / "tileset.json").exists())

    def test_build_replaces_existing_output_without_stale_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            (output / "visual").mkdir(parents=True)
            stale = output / "visual" / "obsolete.glb"
            stale.write_bytes(b"obsolete")
            result, _stdout, stderr = run_cli(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "build",
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(result, 0, stderr)
            self.assertFalse(stale.exists())
            self.assertEqual(tree_hashes(output), tree_hashes(GOLDEN))

    def test_package_replaces_existing_output_without_stale_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            normalized = root / "normalized.json"
            result, _stdout, stderr = run_cli(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "normalize",
                    "--output",
                    str(normalized),
                ]
            )
            self.assertEqual(result, 0, stderr)
            output = root / "generated"
            output.mkdir()
            stale = output / "stale.json"
            stale.write_text("{}\n", encoding="utf-8")
            result, _stdout, stderr = run_cli(
                [
                    "--repo-root",
                    str(REPO_ROOT),
                    "package-tiles",
                    "--normalized",
                    str(normalized),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(result, 0, stderr)
            self.assertFalse(stale.exists())
            self.assertTrue((output / "release.json").is_file())
            self.assertFalse((output / "normalized").exists())
            self.assertEqual(validate_package(output)["status"], "valid")

    def test_staged_build_failure_preserves_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            output.mkdir()
            previous = output / "old.json"
            previous.write_text('{"old": true}\n', encoding="utf-8")

            def fail_after_writing_staging(staging: Path) -> None:
                (staging / "new.json").write_text('{"new": true}\n', encoding="utf-8")
                raise ContractError("intentional staged failure")

            with self.assertRaisesRegex(ContractError, "intentional staged failure"):
                publish_directory(output, fail_after_writing_staging)
            self.assertEqual(previous.read_text(encoding="utf-8"), '{"old": true}\n')
            self.assertFalse((output / "new.json").exists())

    def test_gameplay_manifest_and_collider_contract_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            manifest_path = output / "gameplay" / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["activationRadiusMeters"] = 0.0
            write_json(manifest_path, manifest)
            with self.assertRaisesRegex(ContractError, "activationRadius"):
                validate_package(output)

            build(output)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            collider_path = output / "gameplay" / manifest["tiles"][0]["collisionUri"]
            collider = json.loads(collider_path.read_text(encoding="utf-8"))
            collider["tileOriginMeters"][0] += 1.0
            write_json(collider_path, collider)
            with self.assertRaisesRegex(ContractError, "tileOriginMeters"):
                validate_package(output)

            build(output)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            collider_path = output / "gameplay" / manifest["tiles"][0]["collisionUri"]
            collider = json.loads(collider_path.read_text(encoding="utf-8"))
            collider["colliders"][0]["minY"] = collider["colliders"][0]["maxY"] + 1.0
            write_json(collider_path, collider)
            with self.assertRaisesRegex(ContractError, "minY"):
                validate_package(output)

            build(output)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            collider_path = output / "gameplay" / manifest["tiles"][0]["collisionUri"]
            collider = json.loads(collider_path.read_text(encoding="utf-8"))
            collider["colliders"][0]["boundsLocal"]["maxY"] += 1.0
            write_json(collider_path, collider)
            with self.assertRaisesRegex(ContractError, "boundsLocal"):
                validate_package(output)

            build(output)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["footprintLocalAxisOrder"][1] = "tile-local-north"
            write_json(manifest_path, manifest)
            with self.assertRaisesRegex(ContractError, "footprintLocalAxisOrder"):
                validate_package(output)

    def test_release_descriptor_exactly_binds_visual_tiles_and_product_uris(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "generated"
            build(output)
            release_path = output / "release.json"
            release = json.loads(release_path.read_text(encoding="utf-8"))
            self.assertEqual(release["schemaVersion"], 1)
            self.assertEqual(release["tilesetUri"], "tileset.json")
            self.assertEqual(release["gameplayManifestUri"], "gameplay/manifest.json")
            self.assertEqual(release["requiredInitialTileIds"], sorted(release["requiredInitialTileIds"]))
            self.assertEqual(len(release["requiredInitialTileIds"]), 6)

            release["requiredInitialTileIds"] = release["requiredInitialTileIds"][:-1]
            write_json(release_path, release)
            with self.assertRaisesRegex(ContractError, "requiredInitialTileIds"):
                validate_package(output)

            build(output)
            release = json.loads(release_path.read_text(encoding="utf-8"))
            release["tilesetUri"] = "../tileset.json"
            write_json(release_path, release)
            with self.assertRaisesRegex(ContractError, "tilesetUri"):
                validate_package(output)

    def test_release_schema_documents_the_narrow_runtime_boundary(self) -> None:
        schema = json.loads(
            (REPO_ROOT / "pipeline/schemas/release.schema.json").read_text(encoding="utf-8")
        )
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(
            schema["required"],
            [
                "schemaVersion",
                "sourceHash",
                "normalizedDerivationSha256",
                "tilesetUri",
                "gameplayManifestUri",
                "requiredInitialTileIds",
            ],
        )


if __name__ == "__main__":
    unittest.main()
