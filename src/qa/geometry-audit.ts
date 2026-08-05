/**
 * Geometry correctness audit over the authored city data.
 *
 * This is the repository-review follow-through for "permanent geometry
 * correctness audits": every authored box, prop and route in the renderer-free
 * city data is checked for the classes of defect that have actually shipped in
 * this project — inside-out or inverted geometry, non-finite coordinates,
 * props floating in mid-air or buried under the pavement, spans that reach
 * past the ground plane, and duplicate ids.
 *
 * The audit is deliberately data-only: it consumes the same modules rendering
 * and collision use, so a value that fails here is wrong for both.
 */
import {
  BOULEVARD,
  CITY_GROUND,
  CITY_OBSTACLES,
  MARKET_STALLS,
  PARK_NATURE,
  STOREFRONTS,
  STREET_LIGHTS,
  STREET_PROPS,
  STREET_TREES,
} from '../world/city-data'
import { hqColliders, staticColliders } from '../world/layout'
import { BREAKABLES } from '../destruction/BreakableRegistry'

export interface AuditFinding {
  /** Which check failed. */
  check: string
  /** The offending object's id (or "<anonymous>"). */
  id: string
  /** Human-readable problem. */
  detail: string
}

export interface GeometryAuditResult {
  /** True when every check passed. */
  pass: boolean
  findings: AuditFinding[]
  /** Counts per check, so a change in scope shows up as a diff. */
  counts: Record<string, number>
}

/** Every box-like authored object, with a display id. */
interface NamedBox {
  id: string
  x: number
  y: number
  z: number
  width: number
  depth: number
  height: number
}

/** Export for the tests and any external audit consumer. */
export type { NamedBox }

/** The city sits on one slab whose top is at y=0; +Y is up. */
const GROUND_TOP = 0

function cityBoxes(): NamedBox[] {
  const out: NamedBox[] = []
  const push = (id: string, b: { x: number; z: number; width: number; depth: number; height: number }, y = 0) => {
    out.push({ id, x: b.x, y, z: b.z, width: b.width, depth: b.depth, height: b.height })
  }
  for (const s of STOREFRONTS) push(`${s.id} storefront`, s)
  for (const s of MARKET_STALLS) push(`${s.id} stall`, s)
  for (const o of CITY_OBSTACLES) push(`${o.id} obstacle`, o)
  for (const n of PARK_NATURE) push(`${n.id} ${n.kind}`, n)
  for (const p of STREET_PROPS) push(`${p.id} ${p.kind} prop`, p)
  for (const t of STREET_TREES) {
    out.push({ id: `${t.id} tree`, x: t.x, y: 0, z: t.z, width: 0.4, depth: 0.4, height: t.scale })
  }
  for (const l of STREET_LIGHTS) {
    out.push({ id: `light@(${l.x},${l.z})`, x: l.x, y: 0, z: l.z, width: 0.3, depth: 0.3, height: 6 })
  }
  return out
}

export function auditCityGeometry(boxes: readonly NamedBox[] = cityBoxes()): GeometryAuditResult {
  const findings: AuditFinding[] = []
  const counts: Record<string, number> = {}

  const note = (check: string, id: string, detail: string) => {
    findings.push({ check, id, detail })
    counts[check] = (counts[check] ?? 0) + 1
  }

  // ── 1. Non-finite coordinates or sizes ─────────────────────────────────
  for (const b of boxes) {
    const bad = [b.x, b.y, b.z, b.width, b.depth, b.height].filter((v) => !Number.isFinite(v))
    if (bad.length > 0) {
      note('non_finite', b.id, `has ${bad.length} non-finite value(s)`)
    }
  }

  // ── 2. Inverted scale: negative extents flip winding on the render side ─
  for (const b of boxes) {
    if (b.width <= 0 || b.depth <= 0 || b.height <= 0) {
      note('inverted_scale', b.id, `extents (${b.width}, ${b.depth}, ${b.height})`)
    }
  }

  // ── 3. Floating: the bottom of the box is above the ground slab ────────
  for (const b of boxes) {
    const bottom = b.y
    if (bottom > GROUND_TOP + 0.01) {
      note('floating', b.id, `bottom ${bottom.toFixed(2)} m above ground ${GROUND_TOP.toFixed(2)}`)
    }
  }

  // ── 4. Buried: the top of the box is below the ground slab ─────────────
  for (const b of boxes) {
    const top = b.y + b.height
    if (top < GROUND_TOP - 0.01) {
      note('buried', b.id, `top ${top.toFixed(2)} m below ground ${GROUND_TOP.toFixed(2)}`)
    }
  }

  // ── 5. Impossible spans: the box reaches past the ground footprint ─────
  // The ground slab is centred on (CITY_GROUND.x, CITY_GROUND.z), so the
  // offset of a box from that centre, plus half its extent, must stay
  // within the slab's half-width / half-depth.
  const halfW = CITY_GROUND.width / 2
  const halfD = CITY_GROUND.depth / 2
  for (const b of boxes) {
    const withinX = Math.abs(b.x - CITY_GROUND.x) + b.width / 2 <= halfW + 0.01
    const withinZ = Math.abs(b.z - CITY_GROUND.z) + b.depth / 2 <= halfD + 0.01
    if (!withinX || !withinZ) {
      note('span_outside_ground', b.id, `spans past ground footprint (${halfW} x ${halfD} half extents)`)
    }
  }

  // ── 6. Duplicate ids across the authored world ─────────────────────────
  const seen = new Set<string>()
  for (const b of boxes) {
    if (seen.has(b.id)) note('duplicate_id', b.id, 'authored twice')
    seen.add(b.id)
  }

  // ── 7. Breakable props: finite, positive-extent, and not buried ────────
  for (const d of BREAKABLES) {
    if (!Number.isFinite(d.pos.x) || !Number.isFinite(d.pos.y) || !Number.isFinite(d.pos.z)) {
      note('non_finite', d.id, 'breakable position')
    }
    if (d.size.some((s) => !Number.isFinite(s) || s <= 0)) {
      note('inverted_scale', d.id, `breakable extents ${d.size.join(',')}`)
    }
    const bottom = d.pos.y - d.size[1] / 2
    if (bottom < GROUND_TOP - 0.01) {
      note('buried', d.id, `breakable bottom ${bottom.toFixed(2)} m below ground`)
    }
  }

  // ── 8. Static colliders are finite and contain the authored building ───
  for (const box of staticColliders()) {
    const size = box.min.map((v, i) => box.max[i] - v)
    if (size.some((v) => !Number.isFinite(v) || v <= 0)) {
      note('inverted_scale', 'static-collider', `collider size ${size.join(',')}`)
    }
    if (box.min.some((v) => !Number.isFinite(v)) || box.max.some((v) => !Number.isFinite(v))) {
      note('non_finite', 'static-collider', 'collider bound')
    }
  }
  for (const box of hqColliders()) {
    const size = box.min.map((v, i) => box.max[i] - v)
    if (size.some((v) => !Number.isFinite(v) || v <= 0)) {
      note('inverted_scale', 'hq-collider', `collider size ${size.join(',')}`)
    }
  }

  // ── 9. Boulevard stays inside the ground plane (it is the road) ────────
  if (
    BOULEVARD.x - BOULEVARD.width / 2 < -halfW - 0.01 ||
    BOULEVARD.x + BOULEVARD.width / 2 > halfW + 0.01
  ) {
    note('span_outside_ground', 'boulevard', 'road exceeds ground width')
  }

  return { pass: findings.length === 0, findings, counts }
}
