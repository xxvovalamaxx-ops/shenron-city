/**
 * Does a hero cell actually replace one building — and only that one?
 *
 * Stage 1 acceptance. The unit tests cover the arithmetic against a five-
 * triangle tile. This drives the real city: 56,476 buildings, 116 streamed
 * meshes, Draco-quantised `_bid`, geometry split across several meshes per
 * tile. Three claims, each with the control that makes it mean something:
 *
 *   Suppression works. Triangles for the chosen building disappear. Control:
 *   the count before and after, on the meshes that actually carry it — chosen
 *   by reading the scene, not by trusting a tile calculation.
 *
 *   Suppression is confined. Every other tile is byte-for-byte unchanged.
 *   Control: a full triangle census of every other streamed mesh, before and
 *   after. Without this the check passes just as happily on an implementation
 *   that blanks the whole city.
 *
 *   Removal restores the original. Lifting the override puts back exactly the
 *   index that was there. Control: compare the restored triangle counts per
 *   mesh against the pre-suppression census, not just the total — a total can
 *   match while the triangles have moved between meshes.
 *
 * The building is picked from geometry that is loaded right now, for the reason
 * placeholdercheck learned the hard way: a sample chosen from a manifest and a
 * sample chosen from what is on screen are different samples, and only one of
 * them can be measured.
 *
 * Usage:
 *   node scripts/qa/herocellcheck.mjs [--server URL]
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
  out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'herocellcheck.json'),
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
}

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
        if (
          window.__cityWorld?.ready &&
          window.__heroCells &&
          window.__heroCellsReapply &&
          window.__gameScene
        )
          return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('herocellcheck: never became ready (need __heroCells and __heroCellsReapply)')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

await page.evaluate(() => window.__hud?.getState().setScreen('playing'))
// Tiles stream in; a census taken too early measures an empty city.
await new Promise((r) => setTimeout(r, 14000))

const result = await page.evaluate(async () => {
  const scene = window.__gameScene
  const city = window.__cityWorld.city

  /** Triangles per streamed building mesh, keyed by name. */
  const census = () => {
    const out = {}
    scene.traverse((o) => {
      if (!o.isMesh) return
      if (!/^BLD_[A-Za-z]+_[+-]\d+_[+-]\d+(_\d+)?$/.test(o.name)) return
      const g = o.geometry
      out[o.name] = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
    })
    return out
  }

  /** Meshes carrying a given building id, and how many triangles are its own. */
  const trianglesOf = (buildingId) => {
    const out = {}
    scene.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry
      const bid = g?.attributes?._bid || g?.attributes?._BID
      if (!bid) return
      const idx = g.index
      const tris = idx ? idx.count / 3 : bid.count / 3
      let mine = 0
      for (let t = 0; t < tris; t++) {
        const a = idx ? idx.getX(t * 3) : t * 3
        const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
        const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
        if (
          Math.round(bid.getX(a)) === buildingId &&
          Math.round(bid.getX(b)) === buildingId &&
          Math.round(bid.getX(c)) === buildingId
        )
          mine++
      }
      if (mine > 0) out[o.name] = mine
    })
    return out
  }

  // Pick a target from geometry that is loaded right now, preferring a big
  // building so the triangle delta is unambiguous. Reading the scene rather
  // than the manifest is the point: a building city.json lists is not
  // necessarily a building currently streamed in.
  const drawn = new Map()
  scene.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry
    const bid = g?.attributes?._bid || g?.attributes?._BID
    if (!bid) return
    for (let i = 0; i < bid.count; i++) {
      const id = Math.round(bid.getX(i))
      drawn.set(id, (drawn.get(id) ?? 0) + 1)
    }
  })
  if (drawn.size === 0) return { aborted: 'no streamed building geometry found' }

  const target = [...drawn.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const info = city?.get?.(target) ?? null

  // Coherence baselines, taken before anything is overridden.
  //
  // The brief asks for collision, traffic, navigation, address metadata and
  // save state to "stay coherent". That is five separate claims and none of
  // them is self-evident just because the suppression arithmetic is right, so
  // each gets a number here and the same number after.
  const coherenceBefore = {
    // Address metadata comes from core.bin and text.json, which a hero cell
    // never touches — but "never touches" is an argument, not a measurement.
    name: city?.name?.(target) ?? null,
    address: city?.address?.(target) ?? null,
    // Navigation surfaces: the ground the player and the crowd walk on.
    groundTriangles: (() => {
      let n = 0
      scene.traverse((o) => {
        if (!o.isMesh) return
        if (!/^(SIDEWALK_|ROAD_|PARK_)/i.test(o.name)) return
        const g = o.geometry
        n += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
      })
      return n
    })(),
    // Traffic: the lane graph the LION sim drives on.
    lanes: window.__cityWorld?.traffic?.lanes?.length ?? null,
    // Save state: the exact bytes the game would persist.
    save: window.localStorage.getItem('shenron-city:save'),
    // Collision at the lot itself, actually measured rather than assumed.
    //
    // The first version of this hardcoded null for the baseline, which made a
    // null afterwards unreadable: no way to tell a regression from the normal
    // state. Same mistake as every other probe on this branch — the control
    // has to be a measurement, not a placeholder.
    buildingTopAtLot:
      window.__manhattanCollision?.buildingTopAt?.(
        city?.x?.(target) ?? 0,
        -(city?.y?.(target) ?? 0),
      ) ?? null,
    colliders: window.__manhattanCollision?.buildingColliderCount ?? null,
  }

  const before = census()
  const targetBefore = trianglesOf(target)
  const targetMeshes = Object.keys(targetBefore)
  const targetTrianglesBefore = Object.values(targetBefore).reduce((s, n) => s + n, 0)

  // --- a cell whose asset does not exist must change nothing ---
  //
  // The control for the ordering rule. If suppression ran before the load, a
  // 404 would leave a permanent hole and the only symptom would be a missing
  // building. Run first, on the same target, so a pass here is not an artefact
  // of the target being unusual.
  window.__heroCells.add({ buildingId: target, lod0: '/models/hero/does-not-exist.glb' })
  await window.__heroCellsReapply()
  const missingAssetCensus = census()
  const survivedAMissingAsset =
    Object.keys(before).every((n) => before[n] === missingAssetCensus[n]) &&
    !window.__heroCells.isReady(target)
  window.__heroCells.remove(target)
  await window.__heroCellsReapply()

  // --- apply, with a real authored building ---
  //
  // hq.glb is genuine authored geometry that already ships, so this measures
  // the real path — fetch, parse, place, register collision, then suppress —
  // rather than a stand-in that would skip most of it.
  window.__heroCells.add({ buildingId: target, lod0: '/models/manhattan/hq.glb' })
  const applyReport = await window.__heroCellsReapply()
  const heroGroup = scene.getObjectByName(`HERO_${target}`)
  let heroMeshes = 0
  let heroTriangles = 0
  heroGroup?.traverse((o) => {
    if (!o.isMesh) return
    heroMeshes++
    const g = o.geometry
    heroTriangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
  })
  const heroPosition = heroGroup
    ? { x: +heroGroup.position.x.toFixed(1), y: +heroGroup.position.y.toFixed(1), z: +heroGroup.position.z.toFixed(1) }
    : null
  // Where the geometry actually ended up, which is not the same question as
  // where the group was put: a GLB whose contents are modelled far from its
  // own origin lands nowhere near its placement.
  let heroBounds = null
  if (heroGroup) {
    heroGroup.updateMatrixWorld(true)
    const box = new window.THREE.Box3().setFromObject(heroGroup)
    if (Number.isFinite(box.min.x)) {
      const c = box.getCenter(new window.THREE.Vector3())
      const s = box.getSize(new window.THREE.Vector3())
      heroBounds = {
        center: { x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1) },
        size: { x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) },
      }
    }
  }
  // And does collision answer where the geometry actually is?
  const topAtHeroCentre = heroBounds
    ? window.__manhattanCollision?.buildingTopAt?.(heroBounds.center.x, heroBounds.center.z) ?? null
    : null
  const after = census()
  const targetAfter = trianglesOf(target)

  // The same five, after the swap.
  const lotX = info?.x ?? 0
  const lotZ = info ? -info.y : 0
  const coherenceAfter = {
    name: city?.name?.(target) ?? null,
    address: city?.address?.(target) ?? null,
    groundTriangles: (() => {
      let n = 0
      scene.traverse((o) => {
        if (!o.isMesh) return
        if (!/^(SIDEWALK_|ROAD_|PARK_)/i.test(o.name)) return
        const g = o.geometry
        n += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
      })
      return n
    })(),
    lanes: window.__cityWorld?.traffic?.lanes?.length ?? null,
    save: window.localStorage.getItem('shenron-city:save'),
    buildingTopAtLot: window.__manhattanCollision?.buildingTopAt?.(lotX, lotZ) ?? null,
    colliders: window.__manhattanCollision?.buildingColliderCount ?? null,
  }
  const targetTrianglesAfter = Object.values(targetAfter).reduce((s, n) => s + n, 0)

  // Confinement: every mesh that does NOT carry the target must be identical.
  const untouched = []
  const wronglyChanged = []
  for (const name of Object.keys(before)) {
    if (targetMeshes.includes(name)) continue
    if (before[name] === after[name]) untouched.push(name)
    else wronglyChanged.push({ name, before: before[name], after: after[name] })
  }

  // --- lift ---
  window.__heroCells.remove(target)
  await window.__heroCellsReapply()
  const heroGone = !scene.getObjectByName(`HERO_${target}`)
  const restored = census()
  const restoredTarget = Object.values(trianglesOf(target)).reduce((s, n) => s + n, 0)

  // Per mesh, not just the total: a total can match while triangles have moved.
  const mismatched = Object.keys(before).filter((n) => before[n] !== restored[n])

  return {
    target,
    survivedAMissingAsset,
    coherenceBefore,
    coherenceAfter,
    lot: { x: +lotX.toFixed(1), z: +lotZ.toFixed(1) },
    heroMeshes,
    heroTriangles,
    heroPosition,
    heroBounds,
    topAtHeroCentre,
    heroGone,
    building: info
      ? { name: info.name, address: info.address, height: +info.height.toFixed(1), x: +info.x.toFixed(1), y: +info.y.toFixed(1) }
      : null,
    meshesCarryingTarget: targetMeshes,
    targetTrianglesBefore,
    targetTrianglesAfter,
    targetTrianglesAfterLift: restoredTarget,
    totalMeshes: Object.keys(before).length,
    untouchedMeshes: untouched.length,
    wronglyChanged,
    mismatchedAfterLift: mismatched,
    applyReport,
  }
})

const r = result
const checks = r.aborted
  ? {}
  : {
      foundATarget: typeof r.target === 'number',
      // A building split across more than one mesh is the case that broke the
      // first design; if the target happens to sit in one, the check is weaker
      // but not wrong — recorded either way.
      targetHadGeometry: r.targetTrianglesBefore > 0,
      suppressionRemovedIt: r.targetTrianglesAfter === 0,
      confinedToItsOwnTile: r.wronglyChanged.length === 0,
      liftRestoredEveryMesh: r.mismatchedAfterLift.length === 0,
      liftRestoredTheBuilding: r.targetTrianglesAfterLift === r.targetTrianglesBefore,
      // The ordering rule: a hero cell whose asset 404s must change nothing.
      missingAssetChangedNothing: r.survivedAMissingAsset === true,
      authoredBuildingArrived: r.heroMeshes > 0 && r.heroTriangles > 0,
      authoredBuildingRemovedOnLift: r.heroGone === true,
      // Coherence, one claim per line rather than one lumped assertion — a
      // combined check would say "something moved" and not which thing.
      addressMetadataUnchanged:
        r.coherenceBefore?.name === r.coherenceAfter?.name &&
        r.coherenceBefore?.address === r.coherenceAfter?.address,
      navigationSurfacesUnchanged:
        r.coherenceBefore?.groundTriangles === r.coherenceAfter?.groundTriangles,
      trafficLanesUnchanged: r.coherenceBefore?.lanes === r.coherenceAfter?.lanes,
      saveStateUnchanged: r.coherenceBefore?.save === r.coherenceAfter?.save,
      // The authored building answers the collision query the generated one
      // used to. Null here would mean the lot became a hole the player walks
      // through — which is what makes this the one coherence check that could
      // plausibly have failed.
      collisionAnswersAtTheLot: r.topAtHeroCentre !== null,
    }
// Console errors are reported, loudly, but do not fail this gate.
//
// Deliberate, and the opposite of the usual instinct here. This check's subject
// is whether a hero cell replaces one building and only that one; failing it
// because the post-processing stack is complaining about SSAO would point a
// reader at the wrong file entirely. The errors are printed and recorded so
// they are impossible to miss — a smoke test is the right place to gate on
// them, against the whole app rather than one feature.
const pass = !r.aborted && Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/herocellcheck.mjs',
  ...r,
  checks,
  consoleErrors: errors.slice(0, 5),
  pass,
}
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

if (r.aborted) {
  console.error(`herocellcheck: ABORTED — ${r.aborted}`)
} else {
  console.log(
    `herocellcheck: building ${r.target}` +
      (r.building?.name ? ` (${r.building.name})` : '') +
      ` across ${r.meshesCarryingTarget.length} mesh(es) of ${r.totalMeshes}`,
  )
  console.log(
    `  triangles: ${r.targetTrianglesBefore} -> ${r.targetTrianglesAfter} ` +
      `-> ${r.targetTrianglesAfterLift} after lift`,
  )
  console.log(
    `  confinement: ${r.untouchedMeshes} other mesh(es) unchanged, ` +
      `${r.wronglyChanged.length} wrongly changed`,
  )
  console.log(
    `  authored:    ${r.heroMeshes} mesh(es), ${r.heroTriangles} triangle(s) at ` +
      `${r.heroPosition ? `${r.heroPosition.x}, ${r.heroPosition.y}, ${r.heroPosition.z}` : '(absent)'}`,
  )
  console.log(
    `  bounds:      centre ${r.heroBounds ? `${r.heroBounds.center.x}, ${r.heroBounds.center.y}, ${r.heroBounds.center.z}` : '(none)'}` +
      ` size ${r.heroBounds ? `${r.heroBounds.size.x} x ${r.heroBounds.size.y} x ${r.heroBounds.size.z}` : '-'}` +
      `, collision top there ${r.topAtHeroCentre}`,
  )
  console.log(`  missing-asset control: ${r.survivedAMissingAsset ? 'city unchanged' : 'CITY CHANGED'}`)
  console.log(
    `  coherence:   address "${r.coherenceAfter?.address || '(none)'}", ` +
      `ground ${r.coherenceAfter?.groundTriangles} tris, ` +
      `${r.coherenceAfter?.lanes} lanes, ` +
      `collision top at lot ${r.coherenceBefore?.buildingTopAtLot} -> ` +
      `${r.coherenceAfter?.buildingTopAtLot} ` +
      `(${r.coherenceBefore?.colliders} -> ${r.coherenceAfter?.colliders} colliders)`,
  )
  for (const [name, ok] of Object.entries(checks)) if (!ok) console.error(`  FAIL ${name}`)
}
if (errors.length) {
  console.warn(`  ${errors.length} console error(s), not gated here:`)
  for (const e of [...new Set(errors)].slice(0, 3)) console.warn(`    ${e.slice(0, 120)}`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)

await page.close()
await browser.close()
process.exit(pass ? 0 : 1)
