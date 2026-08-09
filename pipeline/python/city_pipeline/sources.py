"""Version-lock validation for every compiler input."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .models import ContractError, SourceLockEntry

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _required_string(obj: dict[str, Any], field: str, where: str) -> str:
    value = obj.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{where}.{field} must be a non-empty string")
    return value


def load_source_lock(path: Path, repo_root: Path) -> dict[str, SourceLockEntry]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContractError(f"source lock does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid source lock JSON at {path}: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("lockVersion") != 1:
        raise ContractError("source lock must be an object with lockVersion 1")
    sources = raw.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ContractError("source lock must contain at least one source")

    entries: dict[str, SourceLockEntry] = {}
    root = repo_root.resolve()
    for index, item in enumerate(sources):
        where = f"sources[{index}]"
        if not isinstance(item, dict):
            raise ContractError(f"{where} must be an object")
        source_id = _required_string(item, "sourceId", where)
        if source_id in entries:
            raise ContractError(f"duplicate sourceId: {source_id}")
        relative = Path(_required_string(item, "sourceFile", where))
        if relative.is_absolute():
            raise ContractError(f"{where}.sourceFile must be repository-relative")
        source_file = (root / relative).resolve()
        try:
            source_file.relative_to(root)
        except ValueError as exc:
            raise ContractError(f"{where}.sourceFile escapes the repository") from exc
        digest = _required_string(item, "sha256", where).lower()
        if not SHA256_RE.fullmatch(digest):
            raise ContractError(f"{where}.sha256 must be 64 lowercase hex characters")
        entries[source_id] = SourceLockEntry(
            source_id=source_id,
            dataset_name=_required_string(item, "datasetName", where),
            publisher=_required_string(item, "publisher", where),
            version_or_retrieval_date=_required_string(
                item, "versionOrRetrievalDate", where
            ),
            source_file=source_file,
            sha256=digest,
            original_crs=_required_string(item, "originalCrs", where),
            ground_elevation_vertical_datum=_required_string(
                item, "groundElevationVerticalDatum", where
            ),
            ground_elevation_datum_relation=_required_string(
                item, "groundElevationDatumRelation", where
            ),
            license_note=_required_string(item, "licenseNote", where),
            normalization_script_version=_required_string(
                item, "normalizationScriptVersion", where
            ),
        )
    return entries


def verify_source(entry: SourceLockEntry) -> str:
    if not entry.source_file.is_file():
        raise ContractError(
            f"locked source {entry.source_id} is missing: {entry.source_file}"
        )
    actual = sha256_file(entry.source_file)
    if actual != entry.sha256:
        raise ContractError(
            f"locked source {entry.source_id} hash mismatch: "
            f"expected {entry.sha256}, got {actual}"
        )
    return actual
