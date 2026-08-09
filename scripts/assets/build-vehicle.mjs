/**
 * Assemble the sportback into GLBs the runtime can bind.
 *
 * Emits four tiers into public/models/vehicles/. Each is the same car at a
 * different tessellation — see vehicle-mesh.mjs — so a tier swap does not
 * change the silhouette.
 *
 * Node names follow the contract in src/world/vehicle-asset.ts, which was
 * written and tested before this existed. That ordering is the point: the
 * runtime's requirements are fixed, and the art is authored to them.
 *
 * Usage:
 *   node scripts/assets/build-vehicle.mjs [--out public/models/vehicles]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

import { buildGlb } from './glb-write.mjs'
import { SPORTBACK, buildBody, buildLens, buildWheel, triangleCount } from './vehicle-mesh.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

/**
 * The tiers, and what each is for.
 *
 * L0 is the car you stand next to; L3 is a shape in traffic three streets
 * away. The wheel counts fall faster than the body because a wheel at 200 m is
 * four pixels of dark.
 */
const TIERS = [
  { name: 'lod0', segments: 32, stationStep: 1, radial: 24, profile: 6, wheels: true, lenses: true },
  { name: 'lod1', segments: 20, stationStep: 1, radial: 14, profile: 4, wheels: true, lenses: true },
  { name: 'lod2', segments: 12, stationStep: 2, radial: 8, profile: 3, wheels: true, lenses: false },
  { name: 'lod3', segments: 8, stationStep: 3, radial: 6, profile: 2, wheels: false, lenses: false },
]

/**
 * Materials. Unbranded, generic automotive values.
 *
 * The paint is a mid metallic; the glass dark and smooth; the tyre a rough
 * near-black. Lights carry an emissive factor the runtime scales — it drives
 * emissiveIntensity, so the colour is set here and the brightness at runtime.
 */
const MATERIALS = [
  { name: 'VEH_paint', baseColor: [0.62, 0.64, 0.67, 1], metallic: 0.85, roughness: 0.32 },
  { name: 'VEH_glass', baseColor: [0.05, 0.07, 0.09, 1], metallic: 0.1, roughness: 0.08 },
  { name: 'VEH_tyre', baseColor: [0.055, 0.055, 0.06, 1], metallic: 0, roughness: 0.92 },
  { name: 'VEH_rim', baseColor: [0.72, 0.74, 0.76, 1], metallic: 0.95, roughness: 0.22 },
  {
    name: 'VEH_lamp_head',
    baseColor: [0.86, 0.87, 0.82, 1],
    metallic: 0.1,
    roughness: 0.12,
    emissive: [1, 0.94, 0.78],
  },
  {
    name: 'VEH_lamp_brake',
    baseColor: [0.32, 0.03, 0.03, 1],
    metallic: 0.1,
    roughness: 0.18,
    emissive: [1, 0.11, 0.07],
  },
]
const MAT = Object.fromEntries(MATERIALS.map((m, i) => [m.name, i]))

/** Offset a part's positions, for placing wheels at their hubs. */
function translated(part, [dx, dy, dz]) {
  const positions = part.positions.slice()
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx
    positions[i + 1] += dy
    positions[i + 2] += dz
  }
  return { ...part, positions }
}

function buildTier(tier, spec = SPORTBACK) {
  const meshes = []
  const nodes = []

  const body = buildBody(spec, { segments: tier.segments, stationStep: tier.stationStep })
  meshes.push({ name: 'VEH_body', ...body, material: MAT.VEH_paint })
  nodes.push({ name: 'VEH_body', mesh: 0 })

  if (tier.wheels) {
    const wheel = buildWheel(spec, { radial: tier.radial, profile: tier.profile })
    const half = spec.wheelbase / 2
    for (const [slot, sx, z] of [
      ['fl', -1, half],
      ['fr', 1, half],
      ['rl', -1, -half],
      ['rr', 1, -half],
    ]) {
      // The wheel is generated about the origin and placed by its node
      // transform, so the runtime's steer pivot lands on the hub — which is
      // exactly what vehicle-asset.ts binds to.
      meshes.push({ name: `VEH_wheel_${slot}`, ...wheel, material: MAT.VEH_tyre })
      nodes.push({
        name: `VEH_wheel_${slot}`,
        mesh: meshes.length - 1,
        translation: [sx * spec.trackHalf, spec.wheelRadius, z],
      })
    }
  }

  if (tier.lenses) {
    const nose = spec.length / 2
    for (const [name, material, z, y, bulge, hw] of [
      ['VEH_light_head', MAT.VEH_lamp_head, nose - 0.16, 0.72, 0.055, 0.33],
      ['VEH_light_brake', MAT.VEH_lamp_brake, -nose + 0.14, 0.85, -0.045, 0.36],
    ]) {
      const lens = buildLens({ z, y, bulge, halfWidth: hw, halfHeight: 0.07 })
      // Two lenses per end, left and right, as one mesh — the runtime binds
      // the material, not the node count.
      const left = translated(lens, [-0.44, 0, 0])
      const right = translated(lens, [0.44, 0, 0])
      const positions = [...left.positions, ...right.positions]
      const offset = left.positions.length / 3
      const indices = [...left.indices, ...right.indices.map((i) => i + offset)]
      const normals = [...left.normals, ...right.normals]
      meshes.push({ name, positions, indices, normals, material })
      nodes.push({ name, mesh: meshes.length - 1 })
    }
  }

  const glb = buildGlb({
    meshes,
    materials: MATERIALS,
    nodes,
    generator: 'shenron-city scripts/assets/build-vehicle.mjs',
  })
  return { glb, triangles: meshes.reduce((s, m) => s + m.indices.length / 3, 0), meshes: meshes.length }
}

function main() {
  const argv = process.argv.slice(2)
  const outIndex = argv.indexOf('--out')
  const outDir = resolve(
    REPO_ROOT,
    outIndex >= 0 ? argv[outIndex + 1] : join('public', 'models', 'vehicles'),
  )
  mkdirSync(outDir, { recursive: true })

  console.log('sportback — original design, no marque cues')
  console.log(
    `  ${SPORTBACK.length} x ${SPORTBACK.width} x ${SPORTBACK.height} m, ` +
      `wheelbase ${SPORTBACK.wheelbase} m`,
  )
  for (const tier of TIERS) {
    const { glb, triangles, meshes } = buildTier(tier)
    const file = join(outDir, `sportback_${tier.name}.glb`)
    writeFileSync(file, glb)
    console.log(
      `  ${tier.name}  ${String(triangles).padStart(6)} tris  ${meshes} mesh(es)  ` +
        `${(glb.length / 1024).toFixed(0)} kB  ${relative(REPO_ROOT, file).replaceAll('\\', '/')}`,
    )
  }
  console.log(`  wheel alone: ${triangleCount(buildWheel())} tris`)
}

const entry = process.argv[1]
if (entry && import.meta.url === new URL(`file://${entry.split('\\').join('/')}`).href) {
  main()
}

export { buildTier, TIERS, MATERIALS }
