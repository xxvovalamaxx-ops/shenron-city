"""Command-line entry point for the dependency-free Phase-1 city compiler."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import GENERATOR_VERSION
from .config import load_config
from .models import ContractError
from .normalize import (
    load_normalized,
    normalize_geojson,
    normalized_document_sha256,
)
from .output import publish_directory
from .sources import load_source_lock, verify_source
from .tiles import canonical_json_bytes, package_tiles, write_json
from .validate import validate_package


def _repo_path(repo_root: Path, value: str) -> Path:
    candidate = Path(value)
    return candidate if candidate.is_absolute() else repo_root / candidate


def _contracts(args: argparse.Namespace):
    repo_root = Path(args.repo_root).resolve()
    config = load_config(_repo_path(repo_root, args.config))
    entries = load_source_lock(_repo_path(repo_root, args.lock), repo_root)
    try:
        source = entries[args.source]
    except KeyError as exc:
        raise ContractError(f"source ID is not present in the lock: {args.source}") from exc
    if source.normalization_script_version != GENERATOR_VERSION:
        raise ContractError(
            "locked normalizationScriptVersion does not match this compiler: "
            f"{source.normalization_script_version} != {GENERATOR_VERSION}"
        )
    source_hash = verify_source(source)
    return repo_root, config, source, source_hash


def _normalize(args: argparse.Namespace) -> dict[str, object]:
    repo_root, config, source, source_hash = _contracts(args)
    document, buildings = normalize_geojson(config, source)
    output = _repo_path(repo_root, args.output)
    write_json(output, document)
    return {
        "output": str(output),
        "sourceHash": source_hash,
        "normalizedDerivationSha256": normalized_document_sha256(document),
        "buildings": len(buildings),
    }


def _package(args: argparse.Namespace) -> dict[str, object]:
    repo_root, config, source, source_hash = _contracts(args)
    normalized_path = _repo_path(repo_root, args.normalized)
    document, _buildings = load_normalized(normalized_path)
    expected_document, expected_buildings = normalize_geojson(config, source)
    if canonical_json_bytes(document) != canonical_json_bytes(expected_document):
        raise ContractError(
            "normalized input does not exactly match the locked source and config derivation"
        )
    derivation_hash = normalized_document_sha256(expected_document)
    output = _repo_path(repo_root, args.output)

    def write_product(staging: Path) -> dict[str, object]:
        package_tiles(
            config,
            expected_buildings,
            source,
            source_hash,
            derivation_hash,
            staging,
        )
        return validate_package(staging, source_hash, derivation_hash)

    report = publish_directory(output, write_product)
    return {"output": str(output), **report}


def _build(args: argparse.Namespace) -> dict[str, object]:
    repo_root, config, source, source_hash = _contracts(args)
    output = _repo_path(repo_root, args.output)
    document, buildings = normalize_geojson(config, source)
    derivation_hash = normalized_document_sha256(document)

    def write_product(staging: Path) -> dict[str, object]:
        write_json(staging / "normalized" / "buildings.json", document)
        package_tiles(
            config,
            buildings,
            source,
            source_hash,
            derivation_hash,
            staging,
        )
        return validate_package(staging, source_hash, derivation_hash)

    return publish_directory(output, write_product)


def _validate(args: argparse.Namespace) -> dict[str, object]:
    repo_root, config, source, source_hash = _contracts(args)
    document, _buildings = normalize_geojson(config, source)
    return validate_package(
        _repo_path(repo_root, args.output),
        source_hash,
        normalized_document_sha256(document),
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="city_pipeline")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[3]))
    parser.add_argument("--config", default="data/config/manhattan-hq.json")
    parser.add_argument("--lock", default="data/locks/data-sources.lock.json")
    parser.add_argument("--source", default="phase1-synthetic-buildings")
    subparsers = parser.add_subparsers(dest="command", required=True)
    normalize = subparsers.add_parser("normalize", help="normalize one locked GeoJSON source")
    normalize.add_argument("--output", required=True)
    normalize.set_defaults(handler=_normalize)
    package = subparsers.add_parser("package-tiles", help="package normalized buildings")
    package.add_argument("--normalized", required=True)
    package.add_argument("--output", required=True)
    package.set_defaults(handler=_package)
    build = subparsers.add_parser("build", help="normalize, package, and validate")
    build.add_argument("--output", required=True)
    build.set_defaults(handler=_build)
    validate = subparsers.add_parser("validate", help="validate a packaged output")
    validate.add_argument("--output", required=True)
    validate.set_defaults(handler=_validate)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        result = args.handler(args)
    except ContractError as exc:
        print(f"city_pipeline: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
