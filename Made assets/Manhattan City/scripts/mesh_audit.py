"""
mesh_audit.py — permanent geometry-correctness guard for the Blender build.

The winding bug (P2-062) shipped in five scripts because nothing measured
winding. `Builder.box()` listed its faces inward, signed volume came out -8
for a 2 m cube, backface culling dropped every near face, and the defect
survived because a convex flat-shaded box looks the same from either side.

This module is the permanent version of the HANDOFF §0 check #3:

    signed volume = Σ dot(v0, cross(v1 - v0, v2 - v0)) / 6
    negative means inside-out

It is pure stdlib (house rule: no pyproj, no numpy) and imports nothing from
Blender, so it runs under `python mesh_audit.py --self-test` for a
machine-readable self-check and under `blender -b` inside every
`Builder.to_object()`.

Usage inside an authoring script:

    from mesh_audit import assert_outward
    assert_outward(name, self.verts, self.faces)

`assert_outward` only fires on *closed* meshes (every edge shared by exactly
two faces). Open shells — rooms with doorways, canopies, lift cabs — are
skipped, because an open mesh has no meaningful signed volume. Exterior
solids must be wound outward (volume > 0); interior shells are wound inward
on purpose, so interior scripts use `report_volume` instead of a hard assert.
"""

import json
import sys
from collections import Counter


def signed_volume(verts, faces):
    """Signed volume of a closed triangle-fan mesh. Negative = inside-out.

    Uses the handoff formula Σ dot(v0, cross(v1 - v0, v2 - v0)) / 6, fanned
    per face so non-triangular loops are handled exactly.
    """
    total = 0.0
    for f in faces:
        a = verts[f[0]]
        for i in range(1, len(f) - 1):
            b = verts[f[i]]
            c = verts[f[i + 1]]
            ax, ay, az = a
            bx, by, bz = b
            cx, cy, cz = c
            # cross(b - a, c - a) dotted with a, all in one expression.
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            crx = uy * vz - uz * vy
            cry = uz * vx - ux * vz
            crz = ux * vy - uy * vx
            total += (ax * crx + ay * cry + az * crz) / 6.0
    return total


def is_closed(verts, faces):
    """True when every undirected edge appears in exactly two faces."""
    edges = Counter()
    for f in faces:
        n = len(f)
        for i in range(n):
            e = (f[i], f[(i + 1) % n])
            if e[0] < e[1]:
                edges[e] += 1
            else:
                edges[(e[1], e[0])] += 1
    return all(count == 2 for count in edges.values())


def assert_outward(name, verts, faces, threshold=1e-6):
    """Hard assertion for exterior solid meshes. Skips open meshes.

    Raises AssertionError when a closed mesh has negative signed volume —
    exactly the P2-062 defect class. `threshold` tolerates near-degenerate
    meshes that are closed but effectively flat.
    """
    if not is_closed(verts, faces):
        return
    vol = signed_volume(verts, faces)
    if not (vol > threshold):
        raise AssertionError(
            "inside-out mesh '%s': closed with signed volume %+.6g (expected "
            "positive; a negative volume means the faces wind inward and "
            "backface culling hides every near face)" % (name, vol))


def report_volume(name, verts, faces):
    """Non-fatal diagnostic for interior shells, printed as a JSON line.

    Interior rooms are wound to be seen from inside (faces face in), so a
    closed room legitimately has negative signed volume. This prints the
    number for the record instead of asserting, so an inward-facing interior
    is measured rather than guessed.
    """
    if not is_closed(verts, faces):
        return
    vol = signed_volume(verts, faces)
    print(json.dumps({"mesh": name, "signed_volume": round(vol, 6),
                      "closed": True}))


def _self_test():
    """Machine-readable self-check runnable without Blender."""
    cube = [
        (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
        (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1),
    ]
    outward = [(3, 2, 1, 0), (5, 6, 7, 4), (1, 5, 4, 0),
               (2, 6, 5, 1), (3, 7, 6, 2), (0, 4, 7, 3)]
    inward = [tuple(reversed(f)) for f in outward]

    results = {
        "cube_outward_volume": round(signed_volume(cube, outward), 6),
        "cube_inward_volume": round(signed_volume(cube, inward), 6),
        "cube_closed": is_closed(cube, outward),
        "assert_outward_passes": True,
        "assert_outward_catches_inside_out": False,
        "open_mesh_skipped": True,
    }
    assert_outward("cube", cube, outward)
    try:
        assert_outward("inverted", cube, inward)
        results["assert_outward_catches_inside_out"] = False
    except AssertionError:
        results["assert_outward_catches_inside_out"] = True
    open_faces = outward[:-1]  # drop one face -> open
    assert_outward("open", cube, open_faces)  # must not raise

    expected = 8.0  # 2 m cube
    results["pass"] = (
        abs(results["cube_outward_volume"] - expected) < 1e-6 and
        results["cube_inward_volume"] == -results["cube_outward_volume"] and
        results["cube_closed"] and
        results["assert_outward_catches_inside_out"] is True
    )
    print(json.dumps(results, indent=1))
    return 0 if results["pass"] else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    print(__doc__)
