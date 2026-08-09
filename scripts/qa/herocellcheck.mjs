/**
 * Deterministic browser runtime gate for one shipped W47 hero cell.
 *
 * The previous check exercised a transient, non-W47 target. That could prove
 * the generic suppression arithmetic while saying nothing about any building
 * actually shipped in the W47 canyon. This gate always remounts building
 * 21729, observes its real LOD assets and colliders, then injects a rejected
 * collider registration against that same W47 source. It never substitutes HQ
 * geometry or a synthetic target.
 *
 * The test opens dev-only inspection mode, then fixes its camera at W47 so the
 * real -02/-02 streamed tile is resident. Evidence is only replaced after
 * every runtime assertion passes; a failed run leaves the last known-good
 * evidence intact.
 *
 * Usage:
 *   node scripts/qa/herocellcheck.mjs [--server URL] [--out FILE]
 */
/* global window */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const W47_TARGET_BUILDING_ID = 21729
const W47_INSPECTION_SPAWN = 'reference-driving-canyon'
const W47_TILE_TIMEOUT_MS = 45000

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
  for (const candidate of CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

function w47RuntimeUrl(server) {
  const url = new URL(server)
  // Pin the streamed tile and prevent pointer lock. These parameters exist
  // only in Vite dev builds, which is the only mode supported by this probe.
  url.searchParams.set('spawn', W47_INSPECTION_SPAWN)
  url.searchParams.set('inspect', '1')
  return url.toString()
}

const args = {
  server: 'http://127.0.0.1:5173',
  out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'herocellcheck.json'),
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
}

const qaUrl = w47RuntimeUrl(args.server)
const consoleErrors = []
let browser
let page
let report

try {
  browser = await puppeteer.launch({
    executablePath: resolveExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1280, height: 720 },
  })
  page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(qaUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const booted = await page.evaluate(
    (target) =>
      new Promise((resolveBoot) => {
        const started = Date.now()
        const tick = () => {
          const group = window.__gameScene?.getObjectByName(`HERO_${target}`)
          if (
            window.__cityWorld?.ready &&
            window.__heroCells?.isReady(target) &&
            window.__heroCellsReapply &&
            window.__gameScene &&
            window.__gameCamera &&
            window.__manhattanCollision &&
            window.THREE &&
            group
          ) {
            resolveBoot(true)
            return
          }
          if (Date.now() - started > 120000) {
            resolveBoot(false)
            return
          }
          setTimeout(tick, 250)
        }
        tick()
      }),
    W47_TARGET_BUILDING_ID,
  )
  if (!booted) throw new Error('W47 runtime never became ready')

  await page.evaluate(() => window.__hud?.getState().setScreen('playing'))

  // The inspection route prevents the normal game loop from overwriting the
  // camera, but its initial Canvas pose is generic. Put that fixed camera at
  // the actual W47 lot before asking the streamer for the -02/-02 geometry.
  await page.evaluate((target) => {
    const city = window.__cityWorld.city
    const camera = window.__gameCamera
    const x = city.x(target)
    const z = -city.y(target)
    camera.position.set(x + 80, 72, z + 80)
    camera.lookAt(x, 24, z)
    camera.updateMatrixWorld()
  }, W47_TARGET_BUILDING_ID)

  try {
    await page.waitForFunction(
    (target) => {
      let found = false
      window.__gameScene?.traverse((object) => {
        if (found || !object.isMesh) return
        const geometry = object.geometry
        const bid = geometry?.attributes?._bid ?? geometry?.attributes?._BID
        if (!bid) return
        const original = geometry.userData?.__heroCellOriginalIndex
        const index = original ?? geometry.index
        const indexArray = index?.array ?? index
        const triangleCount = indexArray ? Math.floor(indexArray.length / 3) : Math.floor(bid.count / 3)
        for (let triangle = 0; triangle < triangleCount; triangle++) {
          const a = indexArray ? indexArray[triangle * 3] : triangle * 3
          const b = indexArray ? indexArray[triangle * 3 + 1] : triangle * 3 + 1
          const c = indexArray ? indexArray[triangle * 3 + 2] : triangle * 3 + 2
          if (
            Math.round(bid.getX(a)) === target &&
            Math.round(bid.getX(b)) === target &&
            Math.round(bid.getX(c)) === target
          ) {
            found = true
            return
          }
        }
      })
      return found
    },
      { timeout: W47_TILE_TIMEOUT_MS, polling: 250 },
      W47_TARGET_BUILDING_ID,
    )
  } catch {
    throw new Error(`W47 building ${W47_TARGET_BUILDING_ID} never arrived in a streamed tile`)
  }

  // Lift the actual W47 target before measuring it. It starts legitimately
  // suppressed, so its legacy `_bid` triangles are only observable after this
  // controlled unmount.
  const preparation = await page.evaluate(async (target) => {
    const spec = window.__heroCells.get(target)
    if (!spec) return { spec: null, unmount: null }
    window.__heroCells.remove(target)
    return { spec, unmount: await window.__heroCellsReapply() }
  }, W47_TARGET_BUILDING_ID)
  if (!preparation.spec) throw new Error(`W47 building ${W47_TARGET_BUILDING_ID} is absent from the registry`)

  try {
    await page.waitForFunction(
    (target) => {
      let triangles = 0
      window.__gameScene?.traverse((object) => {
        if (!object.isMesh || !/^BLD_[A-Za-z]+_[+-]\d+_[+-]\d+(_\d+)?$/.test(object.name)) return
        const geometry = object.geometry
        const bid = geometry?.attributes?._bid ?? geometry?.attributes?._BID
        if (!bid) return
        const index = geometry.index
        const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(bid.count / 3)
        for (let triangle = 0; triangle < triangleCount; triangle++) {
          const a = index ? index.getX(triangle * 3) : triangle * 3
          const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
          const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
          if (
            Math.round(bid.getX(a)) === target &&
            Math.round(bid.getX(b)) === target &&
            Math.round(bid.getX(c)) === target
          ) {
            triangles++
          }
        }
      })
      return triangles > 0
    },
      { timeout: W47_TILE_TIMEOUT_MS, polling: 250 },
      W47_TARGET_BUILDING_ID,
    )
  } catch {
    throw new Error(`W47 building ${W47_TARGET_BUILDING_ID} legacy triangles did not restore after unmount`)
  }

  const runtime = await page.evaluate(
    async (target, originalSpec, initialUnmount) => {
      const scene = window.__gameScene
      const registry = window.__heroCells
      const collision = window.__manhattanCollision
      const camera = window.__gameCamera
      const THREE = window.THREE

      const waitFrames = async (count = 4) => {
        for (let frame = 0; frame < count; frame++) {
          await new Promise((resolveFrame) => window.requestAnimationFrame(resolveFrame))
        }
      }

      const meshStats = (root) => {
        let meshes = 0
        let triangles = 0
        root?.traverse((object) => {
          if (!object.isMesh) return
          meshes++
          const geometry = object.geometry
          triangles += geometry.index
            ? Math.floor(geometry.index.count / 3)
            : Math.floor((geometry.attributes.position?.count ?? 0) / 3)
        })
        return { meshes, triangles }
      }

      const legacyTriangles = (buildingId) => {
        const perMesh = {}
        scene.traverse((object) => {
          if (!object.isMesh || !/^BLD_[A-Za-z]+_[+-]\d+_[+-]\d+(_\d+)?$/.test(object.name)) return
          const geometry = object.geometry
          const bid = geometry?.attributes?._bid ?? geometry?.attributes?._BID
          if (!bid) return
          const index = geometry.index
          const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(bid.count / 3)
          let matched = 0
          for (let triangle = 0; triangle < triangleCount; triangle++) {
            const a = index ? index.getX(triangle * 3) : triangle * 3
            const b = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
            const c = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
            if (
              Math.round(bid.getX(a)) === buildingId &&
              Math.round(bid.getX(b)) === buildingId &&
              Math.round(bid.getX(c)) === buildingId
            ) {
              matched++
            }
          }
          if (matched > 0) perMesh[object.name] = matched
        })
        return {
          perMesh,
          meshes: Object.keys(perMesh).length,
          triangles: Object.values(perMesh).reduce((sum, count) => sum + count, 0),
        }
      }

      const heroColliderEntries = (buildingId) =>
        collision.buildingBvhs.filter((entry) => entry.mesh?.name.startsWith(`BLD_HERO_${buildingId}_`))

      const groupCount = (name) => {
        let count = 0
        scene.traverse((object) => {
          if (object.name === name) count++
        })
        return count
      }
      const allHeroGroupCount = () => {
        let count = 0
        scene.traverse((object) => {
          if (/^HERO_\d+$/.test(object.name)) count++
        })
        return count
      }

      const snapshot = (buildingId) => {
        const group = scene.getObjectByName(`HERO_${buildingId}`)
        const lod0 = group?.getObjectByName(`HERO_${buildingId}_LOD0`) ?? null
        const lod1 = group?.getObjectByName(`HERO_${buildingId}_LOD1`) ?? null
        const colliders = heroColliderEntries(buildingId)
        return {
          ready: registry.isReady(buildingId),
          targetGroupCount: groupCount(`HERO_${buildingId}`),
          w47GroupCount: allHeroGroupCount(),
          group: Boolean(group),
          lod0: { exists: Boolean(lod0), visible: lod0?.visible ?? null, ...meshStats(lod0) },
          lod1: { exists: Boolean(lod1), visible: lod1?.visible ?? null, ...meshStats(lod1) },
          legacy: legacyTriangles(buildingId),
          heroColliderCount: colliders.length,
          heroColliderNames: colliders.map((entry) => entry.mesh.name),
          totalBuildingColliderCount: collision.buildingColliderCount,
        }
      }

      const hasTileHit = (reapplyReport, buildingId) =>
        reapplyReport?.tiles?.some((tile) => tile.hit?.includes(buildingId)) ?? false
      const hasTileMiss = (reapplyReport, buildingId) =>
        reapplyReport?.tiles?.some((tile) => tile.missed?.includes(buildingId)) ?? false
      const loadDiagnostic = (reapplyReport, buildingId) =>
        reapplyReport?.sync?.loadedCells?.find((entry) => entry.buildingId === buildingId) ?? null

      // The controlled legacy baseline is the actual W47 building after its
      // authored replacement has been removed, not a target guessed from an
      // on-screen tile.
      const legacyBaseline = snapshot(target)

      registry.add(originalSpec)
      const normalRemount = await window.__heroCellsReapply()
      await waitFrames()
      const normal = snapshot(target)
      const normalLoad = loadDiagnostic(normalRemount, target)

      // `updateHeroLods` runs in the presentation stage. Move the fixed
      // inspection camera through the real cell's configured hysteresis band
      // and wait for that stage rather than toggling visibility directly.
      const savedCameraPosition = camera.position.clone()
      const threshold = normalLoad?.lod1FromMetres ?? originalSpec.lod1FromMetres
      const band = threshold * 0.1
      const targetGroup = scene.getObjectByName(`HERO_${target}`)
      const setCameraDistance = (distance) => {
        camera.position.set(targetGroup.position.x + distance, targetGroup.position.y, targetGroup.position.z)
        camera.updateMatrixWorld()
      }
      setCameraDistance(Math.max(1, threshold - band - 1))
      await waitFrames()
      const nearLod = snapshot(target)
      setCameraDistance(threshold + band + 1)
      await waitFrames()
      const farLod = snapshot(target)
      camera.position.copy(savedCameraPosition)
      camera.updateMatrixWorld()
      await waitFrames()

      // A normal unmount must restore the raw streamed triangles and remove
      // both the authored node and its accepted collider entries.
      registry.remove(target)
      const normalUnmount = await window.__heroCellsReapply()
      await waitFrames()
      const afterNormalUnmount = snapshot(target)

      // Fault injection on the real W47 GLBs: reject `registerInterior` while
      // preserving the loader, geometry, placement and reapply path. Disposal
      // hooks are restored in finally so this cannot contaminate the recovery.
      const originalRegisterInterior = collision.registerInterior
      const originalUnregisterTileBuildings = collision.unregisterTileBuildings
      const originalGeometryDispose = THREE.BufferGeometry.prototype.dispose
      const originalMaterialDispose = THREE.Material.prototype.dispose
      let rejectedRegisterCalls = 0
      let rollbackUnregisterCalls = 0
      let disposedGeometries = 0
      let disposedMaterials = 0
      let zeroColliderRemount
      try {
        collision.registerInterior = () => {
          rejectedRegisterCalls++
        }
        collision.unregisterTileBuildings = function unregisterForFault(root) {
          if (root?.name === `HERO_${target}`) rollbackUnregisterCalls++
          return originalUnregisterTileBuildings.call(this, root)
        }
        THREE.BufferGeometry.prototype.dispose = function disposeGeometry(...disposeArgs) {
          disposedGeometries++
          return originalGeometryDispose.apply(this, disposeArgs)
        }
        THREE.Material.prototype.dispose = function disposeMaterial(...disposeArgs) {
          disposedMaterials++
          return originalMaterialDispose.apply(this, disposeArgs)
        }
        registry.add(originalSpec)
        zeroColliderRemount = await window.__heroCellsReapply()
      } finally {
        collision.registerInterior = originalRegisterInterior
        collision.unregisterTileBuildings = originalUnregisterTileBuildings
        THREE.BufferGeometry.prototype.dispose = originalGeometryDispose
        THREE.Material.prototype.dispose = originalMaterialDispose
      }
      await waitFrames()
      const zeroCollider = snapshot(target)

      // Recover with the very same shipped W47 spec, then reapply once more to
      // catch duplicate groups/colliders created by a supposedly idempotent run.
      registry.add(originalSpec)
      const recoveryRemount = await window.__heroCellsReapply()
      await waitFrames()
      const recovery = snapshot(target)
      const idempotentReapply = await window.__heroCellsReapply()
      await waitFrames()
      const afterIdempotent = snapshot(target)

      return {
        target,
        expectedSpec: {
          lod0: originalSpec.lod0,
          lod1: originalSpec.lod1 ?? null,
          lod1FromMetres: originalSpec.lod1FromMetres ?? null,
        },
        initialUnmount,
        legacyBaseline,
        normalRemount,
        normalLoad,
        normal,
        lodSwitch: {
          configuredDistance: threshold,
          hysteresisBand: band,
          nearProbeDistance: Math.max(1, threshold - band - 1),
          farProbeDistance: threshold + band + 1,
          near: { lod0Visible: nearLod.lod0.visible, lod1Visible: nearLod.lod1.visible },
          far: { lod0Visible: farLod.lod0.visible, lod1Visible: farLod.lod1.visible },
        },
        normalUnmount,
        afterNormalUnmount,
        zeroColliderRemount,
        zeroCollider,
        zeroColliderFault: {
          rejectedRegisterCalls,
          rollbackUnregisterCalls,
          disposedGeometries,
          disposedMaterials,
        },
        recoveryRemount,
        recoveryLoad: loadDiagnostic(recoveryRemount, target),
        recovery,
        idempotentReapply,
        afterIdempotent,
        tileHitDuringNormalRemount: hasTileHit(normalRemount, target),
        tileMissDuringNormalRemount: hasTileMiss(normalRemount, target),
        tileHitDuringZeroColliderFault: hasTileHit(zeroColliderRemount, target),
        tileHitDuringRecovery: hasTileHit(recoveryRemount, target),
      }
    },
    W47_TARGET_BUILDING_ID,
    preparation.spec,
    preparation.unmount,
  )

  // Let any late browser errors from the last render tick arrive before this
  // becomes a gate. Intentional failure is injected entirely in memory, so it
  // must not need a 404 or a suppressed console error exemption.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))

  const checks = {
    actualShippedW47Target:
      runtime.target === W47_TARGET_BUILDING_ID &&
      runtime.expectedSpec.lod0 ===
        `/models/manhattan/hero/w47/building-${W47_TARGET_BUILDING_ID}-lod0.glb` &&
      runtime.expectedSpec.lod1 ===
        `/models/manhattan/hero/w47/building-${W47_TARGET_BUILDING_ID}-lod1.glb`,
    legacyGeometryWasResident:
      runtime.legacyBaseline.legacy.triangles > 0 && runtime.legacyBaseline.legacy.meshes > 0,
    lod0AndLod1Loaded:
      runtime.normal.ready &&
      runtime.normal.targetGroupCount === 1 &&
      runtime.normal.lod0.exists &&
      runtime.normal.lod0.meshes > 0 &&
      runtime.normal.lod0.triangles > 0 &&
      runtime.normal.lod1.exists &&
      runtime.normal.lod1.meshes > 0 &&
      runtime.normal.lod1.triangles > 0,
    configuredLodThresholdApplied:
      runtime.expectedSpec.lod1FromMetres === 300 &&
      runtime.normalLoad?.lod1FromMetres === runtime.expectedSpec.lod1FromMetres &&
      runtime.normalLoad?.hasLod1 === true &&
      runtime.lodSwitch.hysteresisBand === runtime.lodSwitch.configuredDistance * 0.1 &&
      runtime.lodSwitch.near.lod0Visible === true &&
      runtime.lodSwitch.near.lod1Visible === false &&
      runtime.lodSwitch.far.lod0Visible === false &&
      runtime.lodSwitch.far.lod1Visible === true,
    colliderRegisteredBeforeSuppression:
      runtime.normalLoad?.colliderCount > 0 &&
      runtime.normal.heroColliderCount === runtime.normalLoad.colliderCount &&
      runtime.normal.heroColliderCount === runtime.normal.lod0.meshes &&
      runtime.tileHitDuringNormalRemount === true &&
      runtime.tileMissDuringNormalRemount === false &&
      runtime.normal.legacy.triangles === 0,
    normalUnmountRestoredWithoutLeak:
      runtime.normalUnmount?.sync?.unloaded?.includes(W47_TARGET_BUILDING_ID) &&
      runtime.afterNormalUnmount.ready === false &&
      runtime.afterNormalUnmount.targetGroupCount === 0 &&
      runtime.afterNormalUnmount.heroColliderCount === 0 &&
      runtime.afterNormalUnmount.legacy.triangles === runtime.legacyBaseline.legacy.triangles,
    zeroColliderDoesNotSuppressAndDisposes:
      runtime.zeroColliderFault.rejectedRegisterCalls > 0 &&
      runtime.zeroColliderRemount?.sync?.loaded?.includes(W47_TARGET_BUILDING_ID) === false &&
      runtime.zeroColliderRemount?.sync?.loadedCells?.some(
        (entry) => entry.buildingId === W47_TARGET_BUILDING_ID,
      ) === false &&
      runtime.zeroColliderRemount?.sync?.failed?.some(
        (failure) =>
          failure.buildingId === W47_TARGET_BUILDING_ID && /no collider/i.test(failure.reason),
      ) === true &&
      runtime.zeroCollider.ready === false &&
      runtime.zeroCollider.targetGroupCount === 0 &&
      runtime.zeroCollider.heroColliderCount === 0 &&
      runtime.zeroCollider.legacy.triangles === runtime.legacyBaseline.legacy.triangles &&
      runtime.tileHitDuringZeroColliderFault === false &&
      runtime.zeroColliderFault.rollbackUnregisterCalls === 1 &&
      runtime.zeroColliderFault.disposedGeometries >= runtime.normal.lod0.meshes + runtime.normal.lod1.meshes &&
      runtime.zeroColliderFault.disposedMaterials >= runtime.normal.lod0.meshes + runtime.normal.lod1.meshes,
    recoveryRemountDoesNotLeak:
      runtime.recoveryLoad?.colliderCount === runtime.normalLoad?.colliderCount &&
      runtime.tileHitDuringRecovery === true &&
      runtime.recovery.ready === true &&
      runtime.recovery.targetGroupCount === 1 &&
      runtime.recovery.w47GroupCount === 6 &&
      runtime.recovery.heroColliderCount === runtime.normal.heroColliderCount &&
      runtime.recovery.legacy.triangles === 0 &&
      runtime.idempotentReapply?.sync?.loaded?.length === 0 &&
      runtime.idempotentReapply?.sync?.unloaded?.length === 0 &&
      runtime.afterIdempotent.targetGroupCount === runtime.recovery.targetGroupCount &&
      runtime.afterIdempotent.heroColliderCount === runtime.recovery.heroColliderCount &&
      runtime.afterIdempotent.w47GroupCount === runtime.recovery.w47GroupCount,
    noHardConsoleErrors: consoleErrors.length === 0,
  }
  const pass = Object.values(checks).every(Boolean)
  report = {
    generatedBy: 'scripts/qa/herocellcheck.mjs',
    qaUrl,
    ...runtime,
    checks,
    consoleErrors: [...new Set(consoleErrors)],
    pass,
  }
} catch (error) {
  report = {
    generatedBy: 'scripts/qa/herocellcheck.mjs',
    qaUrl,
    target: W47_TARGET_BUILDING_ID,
    failure: error instanceof Error ? error.message : String(error),
    checks: { runtimeCompleted: false, noHardConsoleErrors: consoleErrors.length === 0 },
    consoleErrors: [...new Set(consoleErrors)],
    pass: false,
  }
} finally {
  try {
    await page?.close()
  } catch {
    // A crashed page is already gone; do not mask the QA result with cleanup.
  }
  try {
    await browser?.close()
  } catch {
    // Same rule for Chromium.
  }
}

if (report.pass) {
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)
}

console.log(`herocellcheck: W47 building ${W47_TARGET_BUILDING_ID}`)
if (report.failure) console.error(`  runtime failure: ${report.failure}`)
if (report.normalLoad) {
  console.log(
    `  LOD: ${report.normal.lod0.triangles} near + ${report.normal.lod1.triangles} far triangles; ` +
      `${report.normalLoad.lod1FromMetres} m switch (+/- ${report.lodSwitch.hysteresisBand} m)`,
  )
  console.log(
    `  collider-before-suppress: ${report.normalLoad.colliderCount} accepted; ` +
      `${report.legacyBaseline.legacy.triangles} legacy triangles -> ${report.normal.legacy.triangles}`,
  )
  console.log(
    `  fault rollback: ${report.zeroColliderFault.disposedGeometries} geometry + ` +
      `${report.zeroColliderFault.disposedMaterials} material dispose call(s), ` +
      `${report.zeroColliderFault.rollbackUnregisterCalls} collider unregister`,
  )
}
for (const [name, passed] of Object.entries(report.checks)) {
  if (!passed) console.error(`  FAIL ${name}`)
}
for (const error of report.consoleErrors) console.error(`  browser error: ${error}`)
if (report.pass) {
  console.log(`  PASS - evidence regenerated at ${args.out}`)
} else {
  console.error('  FAIL - existing evidence was left untouched')
}

process.exitCode = report.pass ? 0 : 1
