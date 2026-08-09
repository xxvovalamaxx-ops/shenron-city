/**
 * How many raw placeholder primitives can the player actually see?
 *
 * The brief bans them: "no box vehicle or box pedestrian appears on the hero
 * route", and "a manifest check must fail when a visible raw placeholder
 * primitive is present in a hero scene". This measures the current answer.
 *
 * It is expected to FAIL right now. VehicleRig builds each car from a
 * BoxGeometry body, a BoxGeometry cabin, BoxGeometry lights and four
 * CylinderGeometry wheels; pedestrians are one 0.42 x 1.7 x 0.26 box. The
 * point of the gate is to make that a number that has to go down, not to be
 * green on a build where the cars are boxes.
 *
 * The instrument is validated before the reading is believed. Two controls run
 * first: a positive one that adds N known boxes and expects the count to rise
 * by exactly N, and a negative one that adds an authored-shaped mesh (plain
 * BufferGeometry) and expects it to be ignored. Several earlier probes in this
 * project measured nothing and reported a confident zero — a frozen module
 * namespace, a canvas read with no preserved buffer, a control placed behind
 * the camera. A detector that finds nothing and a detector that is broken look
 * identical from the outside unless you make it find something on purpose.
 *
 * Usage:
 *   node scripts/qa/placeholdercheck.mjs [--server URL] [--radius 150] [--budget 0]
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

function parseArgs(argv) {
  const args = {
    server: 'http://127.0.0.1:5173',
    /**
     * Triage only. Not a filter by default, and deliberately so.
     *
     * The first version of this gated on a 150 m radius around a static
     * capture camera and reported 0 placeholders with a fully validated
     * instrument — 7/7 control boxes detected. The scene contained 101, the
     * nearest 151.1 metres away. It passed by 1.1 m.
     *
     * Two things were wrong. The control proved the detector *fired*; it said
     * nothing about whether the sample reached where the content lived,
     * because every control box was placed at the camera. And a distance
     * snapshot is the wrong instrument for traffic in the first place: a car
     * 151 m away is 10 m away ten seconds later, so "not near the camera right
     * now" is not "not on the hero route".
     *
     * So the gate is the whole streamed scene — anything loaded and visible is
     * somewhere the player can reach — and distance is reported per hit for
     * triage rather than used to exclude.
     */
    radius: undefined,
    budget: 0,
    settleMs: 12000,
    out: join(REPO_ROOT, 'evidence', 'opus', 'assets', 'placeholdercheck.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i]
    if (argv[i] === '--server') args.server = value()
    else if (argv[i] === '--radius') args.radius = Number(value())
    else if (argv[i] === '--budget') args.budget = Number(value())
    else if (argv[i] === '--settle-ms') args.settleMs = Number(value())
    else if (argv[i] === '--out') args.out = value()
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
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

// Street level on the hero corridor, looking down the avenue — where the cars
// and pedestrians are. A rooftop camera would see far fewer of both and
// flatter the result.
await page.goto(
  `${args.server}/?visionCapture=1&visionX=1000&visionY=13.7&visionZ=-3000` +
    '&visionTX=1080&visionTY=12&visionTZ=-2940&visionFov=60' +
    '&visionTime=12&visionRain=0&visionSeed=placeholdercheck',
  { waitUntil: 'domcontentloaded', timeout: 60000 },
)

const booted = await page.evaluate(
  (limit) =>
    new Promise((r) => {
      const t0 = Date.now()
      const tick = () => {
        if (window.__cityWorld?.ready && window.__placeholderCensus && window.__gameScene)
          return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('placeholdercheck: the city never reported ready, or __placeholderCensus is absent')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

// Traffic and crowds need time to spawn; counting before they exist would
// report a clean scene that is only clean because it is empty.
await new Promise((r) => setTimeout(r, args.settleMs))

const result = await page.evaluate(
  ({ radius }) => {
    const THREE = window.THREE
    // The R3F root, not cityWorld — cityWorld carries the city subsystems and
    // has no scene handle. __gameScene is the whole graph, which is what the
    // question is about: vehicles and pedestrians are not city children.
    const scene = window.__gameScene
    const camera = window.__gameCamera
    const origin = camera
      ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      : { x: 0, y: 0, z: 0 }

    const run = () =>
      window.__placeholderCensus(radius === undefined ? { origin } : { radius, origin })

    const baseline = run()

    // --- positive control: does it see a box that is definitely there? ---
    //
    // Half at the camera and half two kilometres away. Near boxes prove the
    // detector fires; far boxes prove the *sample* reaches content that is not
    // underfoot. Only near controls were used at first, and the check then
    // reported a confident 0 on a scene holding 101 placeholders whose nearest
    // was 151 m out. A control that only ever sits where you are looking
    // cannot tell you that you are looking in the wrong place.
    const CONTROL_NEAR = 4
    const CONTROL_FAR = 3
    const CONTROL_BOXES = CONTROL_NEAR + CONTROL_FAR
    const FAR_METRES = 2000
    const controlGroup = new THREE.Group()
    controlGroup.name = 'placeholdercheck-control'
    for (let i = 0; i < CONTROL_BOXES; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xff00ff }),
      )
      const far = i >= CONTROL_NEAR
      m.name = `control-box-${far ? 'far' : 'near'}-${i}`
      m.position.set(origin.x + (far ? FAR_METRES : i * 0.5), origin.y, origin.z)
      controlGroup.add(m)
    }
    scene.add(controlGroup)
    scene.updateMatrixWorld(true)
    const withBoxes = run()

    // Does a radius actually exclude? Proven here rather than assumed, since
    // the filter is what produced the false pass.
    const nearOnly = window.__placeholderCensus({ radius: 100, origin })

    // --- negative control: does it ignore authored-shaped geometry? ---
    const authored = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
      ),
      new THREE.MeshBasicMaterial(),
    )
    authored.name = 'control-authored'
    authored.position.set(origin.x, origin.y, origin.z)
    controlGroup.add(authored)
    scene.updateMatrixWorld(true)
    const withAuthored = run()

    // --- visibility control: does hiding a box remove it? ---
    controlGroup.visible = false
    const hidden = run()

    scene.remove(controlGroup)
    controlGroup.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })

    return {
      baseline,
      controls: {
        expectedBoxes: CONTROL_BOXES,
        detectedBoxes: withBoxes.hits.length - baseline.hits.length,
        /** Far controls found — proves the sample is not just local. */
        expectedFar: CONTROL_FAR,
        detectedFar: withBoxes.hits.filter((h) => h.name.startsWith('control-box-far')).length,
        /** A 100 m radius must keep the near controls and drop the far ones. */
        radiusExcludedFar:
          nearOnly.hits.filter((h) => h.name.startsWith('control-box-far')).length === 0 &&
          nearOnly.hits.filter((h) => h.name.startsWith('control-box-near')).length ===
            CONTROL_NEAR,
        authoredCounted: withAuthored.hits.length - withBoxes.hits.length,
        hiddenCounted: hidden.hits.length - baseline.hits.length,
      },
      camera: origin,
      totalMeshes: baseline.meshes,
    }
  },
  { radius: args.radius },
)

const c = result.controls
const controlOk =
  c.detectedBoxes === c.expectedBoxes &&
  c.detectedFar === c.expectedFar &&
  c.radiusExcludedFar &&
  c.authoredCounted === 0 &&
  c.hiddenCounted === 0

const census = result.baseline
const failed = census.hits.length > args.budget

const report = {
  generatedBy: 'scripts/qa/placeholdercheck.mjs',
  radius: args.radius,
  budget: args.budget,
  camera: result.camera,
  meshesExamined: result.totalMeshes,
  /** Whether the detector was proven to work before its reading was believed. */
  instrumentValidated: controlOk,
  controls: c,
  visiblePlaceholders: census.hits.length,
  allowListed: census.allowed,
  byType: census.byType,
  worstOffenders: census.hits.slice(0, 20),
  consoleErrors: errors.length,
  pass: controlOk && !failed,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

console.log(
  `placeholdercheck: ${census.hits.length} visible placeholder primitive(s) ` +
    `of ${result.totalMeshes} mesh(es)` +
    (args.radius === undefined ? ' in the loaded scene' : ` within ${args.radius} m`) +
    `\n  instrument: ${controlOk ? 'VALIDATED' : 'NOT VALIDATED'} — ` +
    `${c.detectedBoxes}/${c.expectedBoxes} control boxes seen ` +
    `(${c.detectedFar}/${c.expectedFar} of them 2 km out), ` +
    `radius excludes correctly: ${c.radiusExcludedFar}, ` +
    `${c.authoredCounted} authored miscounted, ${c.hiddenCounted} hidden miscounted`,
)
for (const [type, n] of Object.entries(census.byType).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type.padEnd(20)} ${n}`)
}
for (const hit of census.hits.slice(0, 6)) {
  console.log(`      ${hit.geometry} ${hit.name} @ ${hit.distance} m  <- ${hit.path.join(' < ')}`)
}
console.log(`  ${report.pass ? 'PASS' : 'FAIL'} (budget ${args.budget}) — ${args.out}`)

if (!controlOk) {
  console.error(
    '  the control did not behave — this reading means nothing until it does',
  )
}

await page.close()
await browser.close()
// 2 rather than 1 when the instrument itself is untrustworthy: a failed gate
// and a broken gate are different problems and should not share an exit code.
process.exit(!controlOk ? 2 : failed ? 1 : 0)
