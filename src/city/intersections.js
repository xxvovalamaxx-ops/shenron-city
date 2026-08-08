// intersections.js — the junction model shared by both traffic sims.
//
// Build-time extraction over the LION lane graph: every node of degree 3+
// becomes an intersection record — the signalled approaches (incoming
// lanes), their stop lines, the conflict pairs between crossing approaches,
// and the fixed two-phase signal program with a per-node offset so the
// whole city does not blink together. Everything here is pure data over the
// graph — no THREE, no React — so city/traffic.js and the Phase 3A vehicle
// sim arbitrate junctions through exactly the same model.
//
// Two-phase cycle, matching the legacy traffic.js behaviour: axis 0 (roughly
// east-west streets) holds green during the first half of the cycle, axis 1
// during the second, and the tail of each half is amber (green 11 s, amber
// 2 s, then all-red clearance until the cross-street phase).

import { hash1 } from './street-nav.js'

export const STOP_LINE = 6.0       // metres back from the node
export const SIGNAL_CYCLE = 26.0   // seconds for a full two-phase cycle
export const SIGNAL_GREEN = 11.0   // green per phase
export const SIGNAL_AMBER = SIGNAL_CYCLE / 2 - SIGNAL_GREEN  // 2 s

// ---- build ----------------------------------------------------------------

/**
 * Extract the signalled intersections from the lane graph.
 *
 * `nodes` is the LION node array ([x, y] pairs); `lanes` the built lane
 * array from `buildLaneGraph` (street-nav.js). A lane that ends at a node
 * of drivable degree 3+ is a signalled approach; its node is an
 * intersection. Returns `{ list, byNode }` so callers can look an
 * intersection up per node without re-scanning lanes every frame.
 */
export function buildIntersections(nodes, lanes, nodeLanes) {
  const list = []
  const byNode = new Map()

  const degree = (node) => nodeLanes?.get(node)?.length ?? 0
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]
    if (!lane.signalled) continue
    if (byNode.has(lane.to)) continue
    const [x, y] = nodes?.[lane.to] ?? [0, 0]
    const approaches = []
    for (const other of lanes) {
      if (other.signalled && other.to === lane.to) approaches.push(other.id)
    }
    const record = {
      node: lane.to,
      x,
      y,
      approaches,
      stopLine: STOP_LINE,
      // The box the approach stop lines bound: far enough back that a car
      // waiting at its line clears the crossing approaches' paths.
      boxRadius: STOP_LINE + 4.5,
      conflicts: crossingPairs(approaches, lanes),
      program: {
        cycle: SIGNAL_CYCLE,
        green: SIGNAL_GREEN,
        amber: SIGNAL_AMBER,
        offset: hash1(lane.to) * SIGNAL_CYCLE,
      },
    }
    byNode.set(lane.to, record)
    list.push(record)
  }
  return { list, byNode }
}

/**
 * Approach pairs whose through paths cross in the box: headings differ by a
 * turn (roughly 35° to 140°) but are not the same street in the same or
 * opposite direction — those share or parallel the same path. Left-turn
 * conflicts against opposing through traffic are resolved at arbitration
 * time (they depend on the turn actually chosen), not here.
 */
function crossingPairs(approachIds, lanes) {
  const pairs = []
  for (let a = 0; a < approachIds.length; a++) {
    for (let b = a + 1; b < approachIds.length; b++) {
      const d = headingDelta(lanes[approachIds[a]].heading, lanes[approachIds[b]].heading)
      const mag = Math.abs(d)
      if (mag > 0.6 && mag < 2.4) pairs.push([a, b])
    }
  }
  return pairs
}

// ---- signal state ----------------------------------------------------------

/**
 * Signal colour for one approach of an intersection at sim time `clock`
 * (seconds). A lane's `axis` selects its phase; `'amber'` occupies the tail
 * of the green half-cycle. Unsignalled approaches are always green.
 */
export function signalColorAt(ix, axis, clock) {
  if (!ix) return 'green'
  const half = ix.program.cycle / 2
  const t = (clock + ix.program.offset) % ix.program.cycle
  const phase = t < half ? 0 : 1
  const within = t % half
  if (phase !== axis) return 'red'
  if (within < ix.program.green) return 'green'
  return 'amber'
}

// ---- turn classification ----------------------------------------------------

/**
 * Classify the turn from an approach heading to an outgoing lane heading:
 * straight, left, right, or a U-turn (refused by routing). Heading delta is
 * positive turning left in the LION plane (+x east, +y north).
 */
export function classifyTurn(inHeading, outHeading) {
  const d = headingDelta(inHeading, outHeading)
  if (Math.abs(d) > 2.7) return 'uturn'
  if (Math.abs(d) <= 0.45) return 'straight'
  return d > 0 ? 'left' : 'right'
}

function headingDelta(from, to) {
  let d = to - from
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
