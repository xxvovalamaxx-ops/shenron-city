"""
freeze_baseline.py — Phase 2A: freeze and protect the accepted geographic world.

Runs on system Python.

Produces a tamper-evident record of the accepted Phase 1 foundation so that any
later Phase 2 change can be proven not to have regressed it:

  docs/phase2/BASELINE_HASHES.json   sha256 of every script, cache and artifact
  archive/manhattan-geographic-foundation-v1/   byte copy of the accepted build

The archive is never modified again. `verify_baseline.py` re-hashes and diffs
against this record.

Usage:
  python scripts/phase2/freeze_baseline.py [--archive]
  python scripts/phase2/freeze_baseline.py --accept <path> "<reason>"

`--accept` updates the recorded hash of one file and nothing else, and logs why.
A blanket re-freeze would rubber-stamp whatever else had drifted at the same
time, so accepting a deliberate change is a separate, narrower operation that
leaves an audit trail in BASELINE_HASHES.json under "accepted".
"""

import hashlib
import json
import os
import shutil
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TAG = "manhattan-geographic-foundation-v1"
ARCHIVE = os.path.join(ROOT, "archive", TAG)
DOCS = os.path.join(ROOT, "docs", "phase2")

# What constitutes the foundation, and whether a hash change is a regression.
#
# `enforced` groups are byte-deterministic: identical inputs must produce
# identical bytes, so any change is a real regression.
#
# `recorded` groups are NOT byte-deterministic even from identical input -
# a .blend embeds timestamps and pointer addresses, an MP4 embeds encoder
# metadata, a PNG embeds a timestamp chunk. Hashing those as a gate would
# fail on every rebuild and teach us to ignore the gate. They are recorded
# for provenance and verified instead through the audit and through the
# derived data (the manifest CSV *is* byte-deterministic and is enforced).
TRACKED = {
    "scripts": {"dir": "scripts", "globs": (".py",), "enforced": True},
    "phase2_scripts": {"dir": os.path.join("scripts", "phase2"),
                       "globs": (".py",), "enforced": False},
    "caches": {"dir": os.path.join("source_data", "cache"),
               "globs": (".pkl",), "enforced": True},
    "derived_data": {"files": [
        os.path.join("exports", "building_manifest.csv"),
        os.path.join("exports", "building_index.json"),
        os.path.join("docs", "data_report.json"),
    ], "enforced": True},
    "docs": {"files": [
        os.path.join("docs", "PIPELINE.md"),
        "README.md",
    ], "enforced": False},
    "binary_outputs": {"files": [
        os.path.join("blend", "manhattan_world.blend"),
        os.path.join("exports", "manhattan_world.glb"),
        os.path.join("playblasts", "flythrough.mp4"),
    ], "enforced": False},
    "renders": {"dir": "renders", "globs": (".png",), "enforced": False},
}

# raw Overpass downloads are large and immutable; hash them but never archive
SOURCE_RAW = {"dir": "source_data", "globs": (".json",), "enforced": False}


def sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def collect(spec):
    out = []
    if "files" in spec:
        for rel in spec["files"]:
            p = os.path.join(ROOT, rel)
            if os.path.isfile(p):
                out.append(rel)
        return sorted(out)
    d = os.path.join(ROOT, spec["dir"])
    if not os.path.isdir(d):
        return []
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if os.path.isfile(p) and name.endswith(spec["globs"]):
            out.append(os.path.relpath(p, ROOT))
    return sorted(out)


def accept(rel, reason):
    """Update one file's recorded hash, leaving every other hash alone."""
    out = os.path.join(DOCS, "BASELINE_HASHES.json")
    if not os.path.exists(out):
        print("no baseline to amend; run freeze_baseline.py first")
        return 2
    rec = json.load(open(out, encoding="utf-8"))

    rel = rel.replace("\\", "/").lstrip("./")
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    if not os.path.exists(path):
        print("no such file: %s" % rel)
        return 2

    hit = None
    for group, g in rec["groups"].items():
        if rel in g["files"]:
            hit = (group, g["files"][rel])
            break
    if not hit:
        print("%s is not in the baseline; re-freeze if it is genuinely new"
              % rel)
        return 2

    group, entry = hit
    old = entry["sha256"]
    new = sha256(path)
    if old == new:
        print("%s already matches the baseline; nothing to accept" % rel)
        return 0

    entry["sha256"] = new
    entry["bytes"] = os.path.getsize(path)
    rec.setdefault("accepted", []).append({
        "path": rel,
        "group": group,
        "from": old,
        "to": new,
        "reason": reason,
        "when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rec, f, indent=1)

    print("=" * 74)
    print("BASELINE AMEND  (%s)" % group)
    print("=" * 74)
    print("  path   : %s" % rel)
    print("  from   : %s" % old[:16])
    print("  to     : %s" % new[:16])
    print("  reason : %s" % reason)
    print("  total accepted changes since freeze: %d" % len(rec["accepted"]))
    print("=" * 74)
    return 0


def main(argv):
    if "--accept" in argv:
        i = argv.index("--accept")
        rest = argv[i + 1:]
        if len(rest) < 2:
            print('usage: --accept <path> "<reason>"')
            return 2
        return accept(rest[0], " ".join(rest[1:]))

    do_archive = "--archive" in argv
    os.makedirs(DOCS, exist_ok=True)

    record = {
        "tag": TAG,
        "frozen_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "root": ROOT,
        "groups": {},
        "totals": {},
    }

    print("=" * 74)
    print("PHASE 2A  FREEZE  ->  %s" % TAG)
    print("=" * 74)

    grand_files = 0
    grand_bytes = 0
    for group, spec in list(TRACKED.items()) + [("source_raw", SOURCE_RAW)]:
        files = collect(spec)
        entries = {}
        gbytes = 0
        for rel in files:
            p = os.path.join(ROOT, rel)
            size = os.path.getsize(p)
            entries[rel.replace("\\", "/")] = {
                "sha256": sha256(p), "bytes": size}
            gbytes += size
        record["groups"][group] = {
            "enforced": bool(spec.get("enforced")),
            "files": entries,
        }
        grand_files += len(files)
        grand_bytes += gbytes
        print("  %-15s %4d files  %9.2f MB   %s"
              % (group, len(files), gbytes / 1e6,
                 "ENFORCED" if spec.get("enforced") else "recorded"))

    record["totals"] = {"files": grand_files,
                        "bytes": grand_bytes,
                        "mb": round(grand_bytes / 1e6, 2)}

    out = os.path.join(DOCS, "BASELINE_HASHES.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=1)
    print("-" * 74)
    print("  hashed %d files / %.1f MB -> %s"
          % (grand_files, grand_bytes / 1e6, os.path.relpath(out, ROOT)))

    if do_archive:
        os.makedirs(ARCHIVE, exist_ok=True)
        copied = 0
        cbytes = 0
        # archive everything except the raw Overpass JSON (regenerable, 200 MB)
        for group in ("scripts", "phase2_scripts", "caches", "derived_data",
                      "docs", "binary_outputs", "renders"):
            for rel in record["groups"].get(group, {}).get("files", {}):
                src = os.path.join(ROOT, rel.replace("/", os.sep))
                dst = os.path.join(ARCHIVE, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if not os.path.exists(dst) or \
                        os.path.getsize(dst) != os.path.getsize(src):
                    shutil.copy2(src, dst)
                copied += 1
                cbytes += os.path.getsize(src)
        with open(os.path.join(ARCHIVE, "FROZEN.txt"), "w",
                  encoding="utf-8") as f:
            f.write("%s\nfrozen %s\n%d files, %.1f MB\n"
                    "DO NOT MODIFY. Regenerate Phase 1 from scripts/ if needed.\n"
                    % (TAG, record["frozen_utc"], copied, cbytes / 1e6))
        print("  archived %d files / %.1f MB -> archive/%s/"
              % (copied, cbytes / 1e6, TAG))

    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
