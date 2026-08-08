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
      headings: approaches.map((id) => lanes[id].heading),
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

// ---- arbitration -------------------------------------------------------------

/**
 * Approach indexes a vehicle on `approachIndex` must yield to at
 * arbitration time: the declared crossing approaches, plus the opposing
 * through approaches when the vehicle will turn left (a left turn cuts
 * across the oncoming street). `willTurnLeft` depends on the route chosen
 * at the node, so it is supplied by the caller, not baked in. Pure and
 * deterministic — both traffic sims arbitrate through this.
 */
export function conflictsFor(ix, approachIndex, willTurnLeft) {
  const out = new Set()
  for (const [a, b] of ix.conflicts) {
    if (a === approachIndex) out.add(b)
    if (b === approachIndex) out.add(a)
  }
  if (willTurnLeft) {
    for (let j = 0; j < ix.approaches.length; j++) {
      if (j === approachIndex) continue
      const d = headingDelta(ix.headings[approachIndex], ix.headings[j])
      if (Math.abs(d) > 2.4) out.add(j)
    }
  }
  return [...out]
}

// ---- signal state ----------------------------------------------------------

/**
 * Signal colour for one approach of an intersection at sim time `clock`
 * (seconds). A lane's `axis` selects its phase; `'amber'` occupies the tail
 * of the green half-cycle. Unsignalled approaches are always green.
 */
export function signalPhase(ix, axis, clock) {
  if (!ix) return 'green'
  const half = ix.program.cycle / 2
  const t = (clock + ix.program.offset) % ix.program.cycle
  const phase = t < half ? 0 : 1
  const within = t % half
  if (phase !== axis) return 'red'
  if (within < ix.program.green) return 'green'
  return 'amber'
}

/** Colour for a lane that may carry its own baked signal copy. */
export function signalColorAt(ix, axis, clock) {
  return signalPhase(ix, axis, clock)
}

// ---- stop-line braking --------------------------------------------------------

/**
 * Target speed (m/s) for a vehicle braking to a full stop exactly at the
 * stop line, or null when no braking is called for. `toStop` is the
 * distance from the vehicle's nose to the stop line; `gap` (metres,
 * default 2) is the small resting clearance before the line. A vehicle
 * whose nose is already across the line has committed and is left alone.
 */
export function stopLineTarget(speed, toStop, brakeDecel, gap = 2) {
  if (toStop <= 0) return null
  const stopDist = speed * speed / (2 * brakeDecel) + gap
  if (toStop <= stopDist) return Math.max(0, speed * (toStop / Math.max(stopDist, 1e-3)))
  return null
}

/**
 * Amber dilemma check: may the vehicle run the amber rather than brake?
 * If the stopping distance at the current speed overshoots the line, the
 * car cannot stop comfortably and must continue through — braking would
 * only leave it blocking the crossing phase.
 */
export function amberMayContinue(toStop, speed, brakeDecel) {
  return speed > 0 && speed * speed / (2 * brakeDecel) > toStop
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
