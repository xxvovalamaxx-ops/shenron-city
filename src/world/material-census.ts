/**
 * Which material system is actually bound to each streamed tier, and whether
 * the geometry can feed it.
 *
 * The Opus brief asks for "runtime assertions [that] expose which material
 * system is bound to each streamed building tier", and the reason is a defect
 * this would have caught on its own: `getRoadNightMaterial` declared
 * `vertexColors: true` while ROAD_* meshes carry only POSITION and NORMAL.
 * WebGL supplies (0,0,0,1) for a missing attribute, so diffuse resolved to
 * white x black and every road in the city shaded pure black. Nothing threw.
 * Nothing warned. The static audit found it by reading two files an hour
 * apart.
 *
 * So this reports bindings *and* checks the contract between a material and
 * the geometry under it. A material that reads an attribute the geometry does
 * not have is the bug; a geometry carrying an attribute its material ignores
 * is usually waste and occasionally the same bug in reverse.
 *
 * Deliberately structural rather than three-typed: it walks anything with
 * `children`, `name`, `geometry.attributes` and `material`, so the whole thing
 * is testable as plain objects with no renderer, no scene and no GPU.
 */

/** The minimum shape a census needs. Three's objects satisfy it. */
export interface CensusMaterial {
  name?: string
  type?: string
  vertexColors?: boolean
  map?: unknown
  normalMap?: unknown
  uuid?: string
  userData?: Record<string, unknown>
}

export interface CensusGeometry {
  attributes?: Record<string, unknown>
}

export interface CensusObject {
  name?: string
  visible?: boolean
  children?: CensusObject[]
  geometry?: CensusGeometry
  material?: CensusMaterial | CensusMaterial[]
  isMesh?: boolean
}

/**
 * Tier of a mesh, from its exported name.
 *
 * The exporter's naming is the only classification available at runtime —
 * there is no tier field on the meshes — so this mirrors the prefixes the
 * tile builder writes and the streamer branches on.
 */
export function classifyTier(name: string): string {
  const n = (name || '').toUpperCase()
  if (n.startsWith('BLD_LOWRISE')) return 'BLD_lowrise'
  if (n.startsWith('BLD_MIDRISE')) return 'BLD_midrise'
  if (n.startsWith('BLD_TOWERS')) return 'BLD_towers'
  if (n.startsWith('BLD_')) return 'BLD_other'
  if (n.startsWith('ROADMARK_')) return 'ROADMARK'
  if (n.startsWith('ROAD_')) return 'ROAD'
  if (n.startsWith('SIDEWALK_')) return 'SIDEWALK'
  if (n.startsWith('LAND_')) return 'LAND'
  if (n.startsWith('WATER_')) return 'WATER'
  if (n.startsWith('PARK_')) return 'PARK'
  if (n.startsWith('BRIDGE_')) return 'BRIDGE'
  if (n.startsWith('LOD')) return 'LOD'
  if (n.startsWith('INT_')) return 'INTERIOR'
  if (n.startsWith('GLAZE_')) return 'INTERIOR_GLASS'
  return 'other'
}

export interface CensusProblem {
  tier: string
  mesh: string
  material: string
  problem: string
  severity: 'error' | 'warning'
}

export interface TierBinding {
  tier: string
  meshes: number
  /** Distinct materials bound to this tier, by label. */
  materials: string[]
  /** True when every mesh in the tier carries a COLOR_0 attribute. */
  allHaveColor: boolean
  /** True when any material bound to the tier reads vertex colours. */
  readsVertexColor: boolean
}

export interface Census {
  tiers: TierBinding[]
  problems: CensusProblem[]
  meshes: number
}

function label(material: CensusMaterial): string {
  return material.name || material.type || 'unnamed'
}

/**
 * Walk a scene and report what is bound where, plus any broken contracts.
 *
 * Invisible meshes are included on purpose. A tier that is hidden right now
 * still renders when it is shown, and a census that only sees what is on
 * screen would report differently on every run.
 */
export function censusMaterials(root: CensusObject): Census {
  const byTier = new Map<
    string,
    { meshes: number; materials: Set<string>; withColor: number; readsColor: boolean }
  >()
  const problems: CensusProblem[] = []
  let meshes = 0

  const visit = (object: CensusObject) => {
    if (object.isMesh && object.geometry) {
      meshes++
      const tier = classifyTier(object.name ?? '')
      const attributes = object.geometry.attributes ?? {}
      const hasColor = 'color' in attributes || 'COLOR_0' in attributes
      const hasUv = 'uv' in attributes || 'TEXCOORD_0' in attributes

      let entry = byTier.get(tier)
      if (!entry) {
        entry = { meshes: 0, materials: new Set(), withColor: 0, readsColor: false }
        byTier.set(tier, entry)
      }
      entry.meshes++
      if (hasColor) entry.withColor++

      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : []

      for (const material of materials) {
        entry.materials.add(label(material))
        if (material.vertexColors) entry.readsColor = true

        if (material.vertexColors && !hasColor) {
          // The road bug, exactly. WebGL feeds (0,0,0,1) for the missing
          // attribute, so the surface renders black with no diagnostic.
          problems.push({
            tier,
            mesh: object.name ?? '(unnamed)',
            material: label(material),
            problem:
              'material reads vertex colours but the geometry has no colour attribute — renders black',
            severity: 'error',
          })
        }
        if ((material.map || material.normalMap) && !hasUv) {
          problems.push({
            tier,
            mesh: object.name ?? '(unnamed)',
            material: label(material),
            problem: 'material samples a texture but the geometry has no UVs',
            severity: 'error',
          })
        }
        if (!material.vertexColors && hasColor && tier.startsWith('BLD_')) {
          // Buildings carry COLOR_0 for a reason; ignoring it flattens the
          // city to one hue, which is the failure the streamer's own comment
          // warns about in the other direction.
          problems.push({
            tier,
            mesh: object.name ?? '(unnamed)',
            material: label(material),
            problem: 'geometry carries COLOR_0 but the material ignores it',
            severity: 'warning',
          })
        }
      }
    }
    for (const child of object.children ?? []) visit(child)
  }

  visit(root)

  const tiers: TierBinding[] = [...byTier.entries()]
    .map(([tier, e]) => ({
      tier,
      meshes: e.meshes,
      materials: [...e.materials].sort(),
      allHaveColor: e.withColor === e.meshes,
      readsVertexColor: e.readsColor,
    }))
    .sort((a, b) => a.tier.localeCompare(b.tier))

  return { tiers, problems, meshes }
}

/** One-line-per-tier summary, for a console or a log. */
export function formatCensus(census: Census): string {
  const lines = [`material census: ${census.meshes} mesh(es), ${census.tiers.length} tier(s)`]
  for (const t of census.tiers) {
    lines.push(
      `  ${t.tier.padEnd(16)} ${String(t.meshes).padStart(4)} mesh  ` +
        `colour=${t.allHaveColor ? 'all' : 'none/partial'}  ` +
        `reads=${t.readsVertexColor}  ${t.materials.join(', ')}`,
    )
  }
  const errors = census.problems.filter((p) => p.severity === 'error')
  lines.push(`  problems: ${errors.length} error(s), ${census.problems.length - errors.length} warning(s)`)
  for (const p of census.problems.slice(0, 12)) {
    lines.push(`    [${p.severity}] ${p.tier} ${p.mesh}: ${p.problem} (${p.material})`)
  }
  return lines.join('\n')
}
