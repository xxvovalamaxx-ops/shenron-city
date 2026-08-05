/**
 * Emits the city geometry audit as machine-readable JSON.
 *
 * The audit checks every authored box, prop, breakable and collider in the
 * renderer-free city data for the geometry correctness defects that have
 * actually shipped in this project: non-finite values, inverted extents,
 * floating/buried props, spans past the ground slab, and duplicate ids.
 *
 * Usage:  node scripts/qa/geometry-audit.mjs
 * Output: JSON on stdout (findings, counts, pass/fail).
 */
import { auditCityGeometry } from '../../src/qa/geometry-audit.js'

const result = auditCityGeometry()
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
process.exitCode = result.pass ? 0 : 1
