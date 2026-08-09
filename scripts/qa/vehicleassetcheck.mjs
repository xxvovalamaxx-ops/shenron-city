/**
 * Does a real glTF loader accept the vehicles we generated, and does the
 * runtime contract bind to them?
 *
 * glb-write.test.mjs asserts the specification rules — chunk padding, accessor
 * alignment, POSITION min/max. Those are the rules that fail *quietly*, and
 * passing them is not the same as a loader accepting the file. This runs the
 * actual three.js GLTFLoader the game uses, against the files on disk, served
 * by the real dev server.
 *
 * Then it binds each tier with the same `bindVehicleAsset` the runtime uses and
 * checks the contract holds: four wheels, both light sets, a steering pivot on
 * the front pair, and dimensions that match the design rather than the
 * exporter's idea of them.
 *
 * Usage:
 *   node scripts/qa/vehicleassetcheck.mjs [--server URL]
 */
/* global window */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  for (const c of CANDIDATES) if (existsSync(c)) return c
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

const args = {
  server: 'http://127.0.0.1:5173',
  out: join(REPO_ROOT, 'evidence', 'opus', 'assets', 'vehicleassetcheck.json'),
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
}

const TIERS = ['lod0', 'lod1', 'lod2', 'lod3']

const browser = await puppeteer.launch({
  executablePath: resolveExecutablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
})
const page = await browser.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(args.server, { waitUntil: 'domcontentloaded', timeout: 60000 })
const booted = await page.evaluate(
  (limit) =>
    new Promise((r) => {
      const t0 = Date.now()
      const tick = () => {
        if (window.THREE) return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('vehicleassetcheck: the page never exposed THREE')
  await browser.close()
  process.exit(2)
}

const result = await page.evaluate(async (tiers) => {
  // The loader the game itself uses, resolved through the dev server so it is
  // the same three build the app runs — a separately fetched copy could be a
  // different version and would prove nothing about what the game will do.
  //
  // Bare specifiers do not resolve inside an evaluate context: Vite rewrites
  // those when it transforms a module, and this string never goes through that
  // transform. `/@id/` is the dev server's own escape hatch for exactly this.
  const loadModule = async (specifier, fallback) => {
    try {
      return await import(/* @vite-ignore */ `/@id/${specifier}`)
    } catch {
      return await import(/* @vite-ignore */ fallback)
    }
  }
  const { GLTFLoader } = await loadModule(
    'three/examples/jsm/loaders/GLTFLoader.js',
    '/node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  )
  const { bindVehicleAsset, validateVehicleAsset } = await import(
    /* @vite-ignore */ '/src/world/vehicle-asset.ts',
  )
  const THREE = window.THREE
  const loader = new GLTFLoader()

  const out = []
  for (const tier of tiers) {
    const url = `/models/vehicles/sportback_${tier}.glb`
    const row = { tier, url }
    let scene
    try {
      scene = (await loader.loadAsync(url)).scene
    } catch (err) {
      row.loadError = err instanceof Error ? err.message : String(err)
      out.push(row)
      continue
    }

    let triangles = 0
    const meshNames = []
    scene.traverse((o) => {
      if (!o.isMesh) return
      meshNames.push(o.name)
      const g = o.geometry
      triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3
    })

    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())

    const bound = bindVehicleAsset(scene)
    const problems = validateVehicleAsset(bound).map((p) => p.problem)

    // Does the steering pivot actually sit on the hub? Bind moves the wheel
    // into a pivot; the wheel's world position must not have moved.
    let steerPivotAtHub = true
    for (const wheel of bound.wheels) {
      if (!wheel.steers) continue
      const p = new THREE.Vector3()
      wheel.pivot.getWorldPosition(p)
      if (Math.abs(p.y - 0.34) > 0.02) steerPivotAtHub = false
    }

    Object.assign(row, {
      triangles,
      meshes: meshNames.length,
      meshNames,
      size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
      wheels: bound.wheels.map((w) => w.slot),
      steering: bound.wheels.filter((w) => w.steers).map((w) => w.slot),
      headMaterials: bound.headMaterials.length,
      brakeMaterials: bound.brakeMaterials.length,
      unmatched: bound.unmatched,
      problems,
      steerPivotAtHub,
    })
    out.push(row)
  }
  return out
}, TIERS)

// lod3 is a silhouette: no wheels, no lenses, by design. Its contract is
// "loads and has the right footprint", not the full binding.
const FULL_CONTRACT = new Set(['lod0', 'lod1'])
const DESIGN = { length: 4.6, width: 1.87, height: 1.38 }

/**
 * How far each tier may sit from the design, in metres.
 *
 * Per tier rather than one number, because a coarse tier legitimately
 * undershoots: tessellating a curved section with 8 segments cannot reach the
 * extremes an 32-segment one does. Measured, lod3 comes out 1.229 m tall
 * against a 1.38 m design — 15 cm short on a body that is only ever seen as a
 * silhouette from a few hundred metres. A single flat tolerance either fails
 * that legitimately-coarse tier or is so loose it stops catching a real
 * modelling error on lod0.
 */
const TOLERANCE = { lod0: 0.05, lod1: 0.06, lod2: 0.08, lod3: 0.2 }
// lod0/lod1 were 0.02/0.03 while the tiers were generated from exact loft
// arithmetic. The Blender-authored body carries a 12 mm bevel and a 35 mm
// solidify shell, both of which sit proud of the nominal surface — measured
// 0.021 m on lod0, which is the modifiers doing their job rather than a
// modelling error. Loosened to 0.05, which still catches a wrong unit, a
// mis-scaled export or a station typo, all of which move the car by tens of
// centimetres.

const checks = {
  everyTierLoaded: result.every((r) => !r.loadError),
  everyTierHasGeometry: result.every((r) => (r.triangles ?? 0) > 0),
  dimensionsMatchTheDesign: result.every((r) => {
    if (!r.size) return true
    const tol = TOLERANCE[r.tier] ?? 0.15
    return (
      Math.abs(r.size.z - DESIGN.length) < tol &&
      Math.abs(r.size.x - DESIGN.width) < tol &&
      Math.abs(r.size.y - DESIGN.height) < tol
    )
  }),
  contractSatisfiedOnNearTiers: result
    .filter((r) => FULL_CONTRACT.has(r.tier))
    .every((r) => r.problems?.length === 0),
  frontWheelsSteerOnNearTiers: result
    .filter((r) => FULL_CONTRACT.has(r.tier))
    .every((r) => JSON.stringify(r.steering) === JSON.stringify(['fl', 'fr'])),
  steerPivotsOnTheHub: result
    .filter((r) => FULL_CONTRACT.has(r.tier))
    .every((r) => r.steerPivotAtHub === true),
  noStrayMeshes: result.every((r) => (r.unmatched?.length ?? 0) === 0),
  trianglesDecreaseWithTier: result
    .filter((r) => r.triangles)
    .every((r, i, a) => i === 0 || a[i - 1].triangles > r.triangles),
}
const pass = Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/vehicleassetcheck.mjs',
  design: DESIGN,
  tiers: result,
  checks,
  consoleErrors: errors.slice(0, 5),
  pass,
}
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

for (const r of result) {
  if (r.loadError) {
    console.error(`  ${r.tier}: LOAD FAILED — ${r.loadError}`)
    continue
  }
  console.log(
    `  ${r.tier}  ${String(r.triangles).padStart(5)} tris  ` +
      `${r.size.x} x ${r.size.y} x ${r.size.z} m  ` +
      `wheels [${r.wheels.join(',')}]  steer [${r.steering.join(',')}]  ` +
      `lights ${r.headMaterials}/${r.brakeMaterials}  ` +
      `dev ${Math.max(
        Math.abs(r.size.z - DESIGN.length),
        Math.abs(r.size.x - DESIGN.width),
        Math.abs(r.size.y - DESIGN.height),
      ).toFixed(3)}m` +
      (r.problems.length ? `  problems: ${r.problems.join('; ')}` : ''),
  )
}
for (const [name, ok] of Object.entries(checks)) if (!ok) console.error(`  FAIL ${name}`)
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)

await page.close()
await browser.close()
process.exit(pass ? 0 : 1)
