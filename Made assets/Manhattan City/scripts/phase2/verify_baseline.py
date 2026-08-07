"""
verify_baseline.py — Phase 2 regression gate for the accepted foundation.

Re-hashes the tracked foundation files and diffs against BASELINE_HASHES.json,
then diffs the current audit against BASELINE_AUDIT.json.

Exit code is non-zero if any *protected* thing regressed, so this can gate a
build. Phase 2 is expected to ADD files; that is reported but not a failure.
Changes to Phase 1 script logic or a drop in audit results ARE failures.

Usage:
  python scripts/phase2/verify_baseline.py [--audit path] [--strict-scripts]
"""

import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOCS = os.path.join(ROOT, "docs", "phase2")
HASHES = os.path.join(DOCS, "BASELINE_HASHES.json")
BASE_AUDIT = os.path.join(DOCS, "BASELINE_AUDIT.json")

# Files Phase 2 is explicitly allowed to extend. Everything else in `scripts`
# is Phase 1 logic and a content change is a regression unless intentional.
MUTABLE = {
    "scripts/98_audit.py",           # audit gains Phase 2 checks
    "scripts/99_build.py",           # build gains Phase 2 stages
    "docs/PIPELINE.md",
    "README.md",
}


def sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main(argv):
    if not os.path.exists(HASHES):
        print("no baseline; run freeze_baseline.py first")
        return 2
    base = json.load(open(HASHES, encoding="utf-8"))

    changed, missing, added, ok, drifted = [], [], [], 0, []
    for group, gdata in base["groups"].items():
        if group == "source_raw":
            continue                    # raw downloads are immutable by nature
        enforced = gdata.get("enforced", True)
        for rel, meta in gdata.get("files", {}).items():
            p = os.path.join(ROOT, rel.replace("/", os.sep))
            if not os.path.isfile(p):
                missing.append(rel)
                continue
            if sha256(p) != meta["sha256"]:
                # a non-enforced group is expected to differ byte-wise on every
                # rebuild (blend/mp4/png embed timestamps); only note it
                (changed if enforced else drifted).append(rel)
            else:
                ok += 1

    # new scripts are expected in Phase 2
    sd = os.path.join(ROOT, "scripts")
    known = set(base["groups"].get("scripts", {}).get("files", {}).keys())
    for name in sorted(os.listdir(sd)):
        rel = ("scripts/" + name)
        if name.endswith(".py") and rel not in known:
            added.append(rel)

    print("=" * 74)
    print("BASELINE VERIFY   (frozen %s)" % base["frozen_utc"])
    print("=" * 74)
    print("  unchanged      : %d" % ok)
    print("  added (Phase 2): %d" % len(added))
    for a in added[:20]:
        print("        + %s" % a)
    print("  changed        : %d  (enforced groups)" % len(changed))
    for c in changed:
        tag = "ALLOWED" if c in MUTABLE else "REGRESSION"
        print("        ~ %-46s %s" % (c, tag))
    print("  drifted        : %d  (non-deterministic containers, expected)"
          % len(drifted))
    for d in drifted[:8]:
        print("        . %s" % d)
    print("  missing        : %d" % len(missing))
    for m in missing:
        print("        - %s" % m)

    hard = [c for c in changed if c not in MUTABLE] + missing

    # ---- audit comparison -----------------------------------------------
    audit_path = argv[argv.index("--audit") + 1] if "--audit" in argv else \
        os.path.join(ROOT, "docs", "audit.json")
    audit_delta = None
    if os.path.exists(BASE_AUDIT) and os.path.exists(audit_path):
        b = json.load(open(BASE_AUDIT, encoding="utf-8"))
        c = json.load(open(audit_path, encoding="utf-8"))
        bnames = {x["name"]: x["status"] for x in b["checks"]}
        cnames = {x["name"]: x["status"] for x in c["checks"]}
        regressed = [n for n, s in bnames.items()
                     if s == "PASS" and cnames.get(n) not in ("PASS", None)]
        dropped = [n for n in bnames if n not in cnames]
        gained = [n for n in cnames if n not in bnames]
        audit_delta = {"baseline_pass": b["pass"], "current_pass": c["pass"],
                       "current_fail": c["fail"],
                       "regressed": regressed, "dropped": dropped,
                       "gained": gained}
        print("-" * 74)
        print("  audit baseline : %d pass / %d fail" % (b["pass"], b["fail"]))
        print("  audit current  : %d pass / %d fail" % (c["pass"], c["fail"]))
        if gained:
            print("  new checks     : %d  %s" % (len(gained), gained[:6]))
        if dropped:
            print("  DROPPED checks : %s" % dropped)
        if regressed:
            print("  REGRESSED      : %s" % regressed)
        hard += regressed + dropped
        if c["fail"]:
            hard.append("audit has %d failing checks" % c["fail"])

    print("=" * 74)
    verdict = "PASS" if not hard else "FAIL"
    print("VERDICT: %s%s" % (verdict, "" if not hard else "  -> %s" % hard[:6]))
    print("=" * 74)

    with open(os.path.join(DOCS, "VERIFY_LAST.json"), "w",
              encoding="utf-8") as f:
        json.dump({"verdict": verdict, "unchanged": ok, "added": added,
                   "changed": changed, "missing": missing,
                   "audit": audit_delta}, f, indent=1)
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
