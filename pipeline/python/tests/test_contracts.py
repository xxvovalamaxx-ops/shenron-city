from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from pipeline.python.city_pipeline.config import parse_config
from pipeline.python.city_pipeline.models import ContractError
from pipeline.python.city_pipeline.normalize import (
    normalize_geojson,
    normalize_ground_elevation,
)
from pipeline.python.city_pipeline.sources import load_source_lock, verify_source


REPO_ROOT = Path(__file__).resolve().parents[3]


class ContractTests(unittest.TestCase):
    def test_committed_source_matches_lock(self) -> None:
        entries = load_source_lock(REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT)
        source = entries["phase1-synthetic-buildings"]
        self.assertEqual(verify_source(source), source.sha256)

    def test_source_hash_tamper_fails_closed(self) -> None:
        entries = load_source_lock(REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT)
        source = entries["phase1-synthetic-buildings"]
        with tempfile.TemporaryDirectory() as temporary:
            tampered = Path(temporary) / "source.geojson"
            tampered.write_bytes(source.source_file.read_bytes() + b"\n")
            with self.assertRaisesRegex(ContractError, "hash mismatch"):
                verify_source(replace(source, source_file=tampered))

    def test_standard_tile_contract_rejects_non_256_size(self) -> None:
        raw = json.loads((REPO_ROOT / "data/config/manhattan-hq.json").read_text(encoding="utf-8"))
        raw["standardTileSizeMeters"] = 300
        with self.assertRaisesRegex(ContractError, "exactly 256"):
            parse_config(raw)

    def test_ground_elevation_normalizes_from_the_explicit_shared_vertical_datum(self) -> None:
        entries = load_source_lock(REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT)
        source = entries["phase1-synthetic-buildings"]
        config = parse_config(json.loads((REPO_ROOT / "data/config/manhattan-hq.json").read_text(encoding="utf-8")))
        self.assertAlmostEqual(normalize_ground_elevation(15.75, config, source), 3.75)

    def test_vertical_datum_contract_rejects_missing_or_ambiguous_source_metadata(self) -> None:
        config_raw = json.loads((REPO_ROOT / "data/config/manhattan-hq.json").read_text(encoding="utf-8"))
        config_raw["hqGeoAnchor"].pop("verticalDatum")
        with self.assertRaisesRegex(ContractError, "hqGeoAnchor.verticalDatum"):
            parse_config(config_raw)

        lock_raw = json.loads((REPO_ROOT / "data/locks/data-sources.lock.json").read_text(encoding="utf-8"))
        lock_raw["sources"][0].pop("groundElevationVerticalDatum")
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / "sources.lock.json"
            lock.write_text(json.dumps(lock_raw), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "groundElevationVerticalDatum"):
                load_source_lock(lock, REPO_ROOT)

        entries = load_source_lock(REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT)
        source = entries["phase1-synthetic-buildings"]
        config = parse_config(json.loads((REPO_ROOT / "data/config/manhattan-hq.json").read_text(encoding="utf-8")))
        with self.assertRaisesRegex(ContractError, "exactly match"):
            normalize_geojson(
                config,
                replace(source, ground_elevation_vertical_datum="EGM96"),
            )
        with self.assertRaisesRegex(ContractError, "same-as-hq-anchor"):
            normalize_geojson(
                config,
                replace(source, ground_elevation_datum_relation="unknown"),
            )

    def test_geojson_adapter_rejects_an_unimplemented_crs(self) -> None:
        entries = load_source_lock(REPO_ROOT / "data/locks/data-sources.lock.json", REPO_ROOT)
        source = entries["phase1-synthetic-buildings"]
        config_raw = json.loads((REPO_ROOT / "data/config/manhattan-hq.json").read_text(encoding="utf-8"))
        with self.assertRaisesRegex(ContractError, "accepts only WGS84"):
            normalize_geojson(parse_config(config_raw), replace(source, original_crs="EPSG:2263"))


if __name__ == "__main__":
    unittest.main()
