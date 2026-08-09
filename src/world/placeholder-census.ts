/**
 * Finding raw placeholder primitives that are actually on screen.
 *
 * The brief bans them by name — "no box vehicle or box pedestrian appears on
 * the hero route", "a manifest check must fail when a visible raw placeholder
 * primitive is present in a hero scene" — and the build is full of them:
 * every car in VehicleRig is a BoxGeometry body with a BoxGeometry cabin and
 * four CylinderGeometry wheels, and every pedestrian is one 0.42 x 1.7 x 0.26
 * box.
 *
 * This does not fix that. It makes the ban enforceable, which is the step
 * before fixing it: a number that goes down as hero art lands, and a gate that
 * fails if someone adds a new box to the route.
 *
 * Detection is by `geometry.type`. Three sets it on every parametric
 * geometry — `BoxGeometry`, `CylinderGeometry`, `ConeGeometry` and so on —
 * and loaded glTF content arrives as plain `BufferGeometry`, so the
 * distinction is exactly "built from a primitive constructor" versus
 * "authored somewhere and imported". That is the real question, and it is
 * more honest than guessing from triangle counts: a low-poly authored asset is
 * not a placeholder, and a subdivided box still is.
 *
 * Structural rather than three-typed, so it tests as plain objects.
 */

/** Geometry types three names for its parametric constructors. */
export const PRIMITIVE_TYPES = new Set([
  'BoxGeometry',
  'CapsuleGeometry',
  'CircleGeometry',
  'ConeGeometry',
  'CylinderGeometry',
  'DodecahedronGeometry',
  'IcosahedronGeometry',
  'LatheGeometry',
  'OctahedronGeometry',
  'PlaneGeometry',
  'RingGeometry',
  'SphereGeometry',
  'TetrahedronGeometry',
  'TorusGeometry',
  'TorusKnotGeometry',
])

/**
 * Primitives that are the right answer rather than a placeholder.
 *
 * A sky dome is a sphere because a sky dome *is* a sphere; the sea is a plane
 * because the sea is a plane. Matching is by name prefix on the mesh or any
 * ancestor, so a whole subtree can be exempted at its root.
 *
 * Deliberately short. Every entry is a promise that something will never be
 * hero art, and a long allowlist is how a ban stops meaning anything.
 */
export const ALLOWED_PREFIXES = [
  'SKY',
  'WEATHER_',
  'WATER_',
  'RAIN',
  'CLOUD',
  'HELPER_',
  'DEBUG_',
]

export interface PlaceholderObject {
  name?: string
  visible?: boolean
  isMesh?: boolean
  children?: PlaceholderObject[]
  geometry?: { type?: string }
  position?: { x: number; y: number; z: number }
  /**
   * World matrix, preferred over `position` when present.
   *
   * Read as raw column-major elements rather than through
   * `getWorldPosition()`, which requires a real `THREE.Vector3` target —
   * passing a plain `{x,y,z}` throws `target.setFromMatrixPosition is not a
   * function`, which is exactly how the first live run of this failed. Reading
   * elements[12..14] needs no three types and allocates nothing.
   *
   * The caller is responsible for `updateMatrixWorld()`; a stale matrix gives
   * a stale distance, not an error.
   */
  matrixWorld?: { elements: ArrayLike<number> }
}

export interface PlaceholderHit {
  name: string
  geometry: string
  /** Path of ancestor names, nearest first — where it came from. */
  path: string[]
  distance: number | null
}

export interface PlaceholderCensus {
  /** Visible primitives that are not allow-listed. */
  hits: PlaceholderHit[]
  /** Counts by geometry type, for a number that can be tracked down. */
  byType: Record<string, number>
  /** Visible primitives skipped because they are allow-listed. */
  allowed: number
  /** Meshes examined. */
  meshes: number
}

export interface PlaceholderOptions {
  /**
   * Only count primitives within this many metres of `origin`.
   *
   * The ban is about the hero route, not the whole island — a placeholder two
   * kilometres away is a content backlog item, not a thing the player is
   * looking at. Omit to count everywhere.
   */
  radius?: number
  origin?: { x: number; y: number; z: number }
  allowedPrefixes?: string[]
}

function isAllowed(path: string[], prefixes: string[]): boolean {
  return path.some((name) => {
    const upper = name.toUpperCase()
    return prefixes.some((p) => upper.startsWith(p))
  })
}

/**
 * Walk a scene and report visible placeholder primitives.
 *
 * Invisible meshes are skipped, unlike the material census — there the
 * question was "what is bound", which does not change when something is
 * hidden, and here it is "what can the player see". A hidden box is not on
 * screen.
 */
export function censusPlaceholders(
  root: PlaceholderObject,
  options: PlaceholderOptions = {},
): PlaceholderCensus {
  const prefixes = options.allowedPrefixes ?? ALLOWED_PREFIXES
  const hits: PlaceholderHit[] = []
  const byType: Record<string, number> = {}
  let allowed = 0
  let meshes = 0

  const visit = (object: PlaceholderObject, path: string[]) => {
    if (object.visible === false) return
    const here = [object.name ?? '', ...path]

    if (object.isMesh) {
      meshes++
      const type = object.geometry?.type
      if (type && PRIMITIVE_TYPES.has(type)) {
        if (isAllowed(here, prefixes)) {
          allowed++
        } else {
          let distance: number | null = null
          if (options.origin) {
            const e = object.matrixWorld?.elements
            const p = e
              ? { x: Number(e[12]), y: Number(e[13]), z: Number(e[14]) }
              : object.position
            if (p) {
              distance = Math.hypot(
                p.x - options.origin.x,
                p.y - options.origin.y,
                p.z - options.origin.z,
              )
            }
          }
          const inRange =
            options.radius === undefined || distance === null || distance <= options.radius
          if (inRange) {
            hits.push({
              name: object.name || '(unnamed)',
              geometry: type,
              path: here.filter(Boolean).slice(0, 4),
              distance: distance === null ? null : +distance.toFixed(1),
            })
            byType[type] = (byType[type] ?? 0) + 1
          }
        }
      }
    }

    for (const child of object.children ?? []) visit(child, here)
  }

  visit(root, [])
  hits.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
  return { hits, byType, allowed, meshes }
}

/** A short report, nearest offenders first. */
export function formatPlaceholders(census: PlaceholderCensus): string {
  const total = census.hits.length
  const lines = [
    `placeholder census: ${total} visible primitive(s) of ${census.meshes} mesh(es)` +
      `, ${census.allowed} allow-listed`,
  ]
  for (const [type, n] of Object.entries(census.byType).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type.padEnd(20)} ${n}`)
  }
  for (const hit of census.hits.slice(0, 8)) {
    lines.push(
      `    ${hit.geometry} ${hit.name}` +
        (hit.distance === null ? '' : ` @ ${hit.distance} m`) +
        `  <- ${hit.path.join(' < ')}`,
    )
  }
  return lines.join('\n')
}
