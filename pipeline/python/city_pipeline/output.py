"""Fail-closed publication for generated compiler directory products.

The compiler must never write directly into a previous generated tree.  A
failed run would otherwise leave a mixture of old and new tiles that can look
valid at a glance.  Every directory product is therefore assembled in a
sibling staging directory, validated by its caller, then swapped into place.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from .models import ContractError


T = TypeVar("T")


def _remove_tree(path: Path) -> None:
    """Best-effort cleanup for a directory that was never published."""

    if path.exists():
        shutil.rmtree(path)


def _replace_directory(staging: Path, output: Path) -> None:
    """Publish a complete staging directory while preserving an old output.

    ``os.replace`` cannot overwrite a non-empty directory on Windows.  Moving
    the old output to a sibling backup first keeps both moves on the same
    filesystem.  If the second move fails, the first output is restored before
    surfacing the failure.  The caller's target is consequently either the
    complete old tree or the complete new tree, never a partially written one.
    """

    if not output.exists():
        os.replace(staging, output)
        return
    if not output.is_dir():
        raise ContractError(f"generated output must be a directory: {output}")

    backup = output.parent / f".{output.name}.previous-{uuid.uuid4().hex}"
    try:
        os.replace(output, backup)
    except OSError as exc:
        raise ContractError(
            f"cannot prepare generated output replacement: {output}: {exc}"
        ) from exc
    try:
        os.replace(staging, output)
    except OSError as exc:
        try:
            os.replace(backup, output)
        except OSError as restore_exc:
            raise ContractError(
                "failed to publish generated output and could not restore the "
                f"previous tree; recovery copy is at {backup}"
            ) from restore_exc
        raise ContractError(
            "failed to publish generated output; the previous tree was restored"
        ) from exc

    # A cleanup failure never invalidates the newly published output.  The
    # backup remains a recoverable sibling rather than becoming stale content
    # under the target directory.
    try:
        _remove_tree(backup)
    except OSError:
        pass


def publish_directory(output: Path, writer: Callable[[Path], T]) -> T:
    """Build a directory product in staging and replace ``output`` atomically.

    ``writer`` receives an empty directory.  Any exception before publication
    removes only that staging directory, preserving a pre-existing output.
    """

    target = output.expanduser()
    parent = target.parent
    try:
        parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ContractError(f"cannot create generated output parent: {parent}") from exc
    if target.exists() and not target.is_dir():
        raise ContractError(f"generated output must be a directory: {target}")

    try:
        staging = Path(
            tempfile.mkdtemp(prefix=f".{target.name}.staging-", dir=str(parent))
        )
    except OSError as exc:
        raise ContractError(f"cannot create generated output staging directory in {parent}") from exc

    published = False
    try:
        result = writer(staging)
        _replace_directory(staging, target)
        published = True
        return result
    except ContractError:
        raise
    except OSError as exc:
        raise ContractError(f"failed to build generated output {target}") from exc
    finally:
        if not published:
            try:
                _remove_tree(staging)
            except OSError:
                pass
