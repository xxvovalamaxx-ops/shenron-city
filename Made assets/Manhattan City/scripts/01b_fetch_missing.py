"""
01b_fetch_missing.py — refetch any building band that failed in the main pass.

Band 4 (Washington Heights / Inwood) timed out on the first run, so it is split
into four narrower slices here. Same cache-and-skip behaviour as 01_fetch_osm.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "source_data"))

ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]

MANHATTAN_AREA = 3600000000 + 8398124
WEST, EAST = -74.0290, -73.9060
# band4 of the original 5-way split
B4_LO, B4_HI = 40.6790 + (40.8850 - 40.6790) * 4 / 5, 40.8850


def run(name, query, timeout_s=900):
    path = os.path.join(OUT, name + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 200:
        print("  [skip] %s (%.1f MB)" % (name, os.path.getsize(path) / 1e6))
        return True
    data = ("data=" + urllib.parse.quote(query.strip())).encode()
    for attempt, ep in enumerate([e for e in ENDPOINTS for _ in range(2)]):
        try:
            print("  [get ] %s via %s" % (name, ep.split("/")[2]))
            t0 = time.time()
            req = urllib.request.Request(
                ep, data=data,
                headers={"User-Agent": "manhattan-world-build/1.0",
                         "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=timeout_s) as r:
                raw = r.read()
            n = len(json.loads(raw.decode("utf-8", "replace")).get("elements", []))
            if n == 0:
                raise ValueError("0 elements")
            open(path, "wb").write(raw)
            print("  [ ok ] %s  %d elements  %.1f MB  %.0fs"
                  % (name, n, len(raw) / 1e6, time.time() - t0))
            return True
        except Exception as e:
            print("  [fail] %s: %s" % (name, str(e)[:140]))
            time.sleep(6)
    return False


def main():
    ok = True
    SLICES = 4
    for i in range(SLICES):
        lo = B4_LO + (B4_HI - B4_LO) * i / SLICES
        hi = B4_LO + (B4_HI - B4_LO) * (i + 1) / SLICES
        q = """
[out:json][timeout:600];
area(%d)->.man;
(
  way["building"](area.man)(%f,%f,%f,%f);
);
out geom;
""" % (MANHATTAN_AREA, lo, WEST, hi, EAST)
        ok &= run("buildings_band4_%d" % i, q)
        time.sleep(2)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
