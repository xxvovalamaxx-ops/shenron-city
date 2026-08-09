import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { TilesRenderer } from '3d-tiles-renderer/r3f'
import type { TilesRenderer as TilesRendererImpl } from '3d-tiles-renderer/three'
import type { Group, Object3D } from 'three'

import { rt } from '../gameplay/runtime'
import {
  PHASE1_AOI_SIZE_METERS,
  PHASE1_HQ_WORLD,
  PHASE1_SPAWN,
} from './phase1-contract'
import {
  Phase1GameplayTileSystem,
  type Phase1GameplayDiagnostics,
} from './phase1-gameplay'
import {
  fetchPhase1Release,
  PHASE1_RELEASE_URL,
  phase1TileId,
  type Phase1Release,
  validatePhase1Tileset,
} from './phase1-release'
import {
  Phase1RuntimeOwnership,
  type Phase1RuntimeLease,
} from './phase1-runtime-ownership'
import { Phase1VisualGate } from './phase1-visual-gate'

const PHASE1_GROUND_POSITION: [number, number, number] = [
  PHASE1_HQ_WORLD.x,
  PHASE1_HQ_WORLD.y - 0.02,
  PHASE1_HQ_WORLD.z,
]
const PHASE1_GROUND_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0]
const PHASE1_SUN_POSITION: [number, number, number] = [
  PHASE1_HQ_WORLD.x + 300,
  PHASE1_HQ_WORLD.y + 450,
  PHASE1_HQ_WORLD.z + 250,
]

interface Phase1Diagnostics {
  status: 'loading' | 'ready' | 'error'
  loadedModels: number
  visibleModels: number
  errors: number
  terminalVisualErrors: number
  releaseVerified: boolean
  requiredVisualModels: number
  loadedRequiredVisualModels: number
  visibleRequiredVisualModels: number
  enterable: boolean
  gameplayStatus: Phase1GameplayDiagnostics['status']
  residentGameplayTiles: number
  pendingGameplayTiles: number
  colliders: number
}

interface RuntimeSession {
  lease: Phase1RuntimeLease
  controller: AbortController
  gate: Phase1VisualGate | null
}

interface VisualRuntimeConfig {
  session: RuntimeSession
  release: Phase1Release
}

type Phase1Window = Window & {
  __phase1TilesRenderer?: TilesRendererImpl
  __phase1TilesDiagnostics?: Readonly<Phase1Diagnostics>
}

function initialDiagnostics(): Phase1Diagnostics {
  return {
    status: 'loading',
    loadedModels: 0,
    visibleModels: 0,
    errors: 0,
    terminalVisualErrors: 0,
    releaseVerified: false,
    requiredVisualModels: 0,
    loadedRequiredVisualModels: 0,
    visibleRequiredVisualModels: 0,
    enterable: false,
    gameplayStatus: 'idle',
    residentGameplayTiles: 0,
    pendingGameplayTiles: 0,
    colliders: 0,
  }
}

function publishDiagnostics(value: Phase1Diagnostics): void {
  const snapshot = Object.freeze({ ...value })
  const root = document.documentElement
  root.dataset.phase1TilesStatus = snapshot.status
  root.dataset.phase1TilesLoaded = String(snapshot.loadedModels)
  root.dataset.phase1TilesVisible = String(snapshot.visibleModels)
  root.dataset.phase1TilesErrors = String(snapshot.errors)
  root.dataset.phase1TilesTerminalVisualErrors = String(snapshot.terminalVisualErrors)
  root.dataset.phase1TilesReleaseVerified = snapshot.releaseVerified ? '1' : '0'
  root.dataset.phase1TilesRequired = String(snapshot.requiredVisualModels)
  root.dataset.phase1TilesRequiredLoaded = String(snapshot.loadedRequiredVisualModels)
  root.dataset.phase1TilesRequiredVisible = String(snapshot.visibleRequiredVisualModels)
  root.dataset.phase1TilesEnterable = snapshot.enterable ? '1' : '0'
  root.dataset.phase1GameplayStatus = snapshot.gameplayStatus
  root.dataset.phase1GameplayResident = String(snapshot.residentGameplayTiles)
  root.dataset.phase1GameplayPending = String(snapshot.pendingGameplayTiles)
  root.dataset.phase1GameplayColliders = String(snapshot.colliders)
  ;(window as Phase1Window).__phase1TilesDiagnostics = snapshot
}

function clearDiagnostics(): void {
  const root = document.documentElement
  delete root.dataset.phase1TilesStatus
  delete root.dataset.phase1TilesLoaded
  delete root.dataset.phase1TilesVisible
  delete root.dataset.phase1TilesErrors
  delete root.dataset.phase1TilesTerminalVisualErrors
  delete root.dataset.phase1TilesReleaseVerified
  delete root.dataset.phase1TilesRequired
  delete root.dataset.phase1TilesRequiredLoaded
  delete root.dataset.phase1TilesRequiredVisible
  delete root.dataset.phase1TilesEnterable
  delete root.dataset.phase1GameplayStatus
  delete root.dataset.phase1GameplayResident
  delete root.dataset.phase1GameplayPending
  delete root.dataset.phase1GameplayColliders
  delete (window as Phase1Window).__phase1TilesRenderer
  delete (window as Phase1Window).__phase1TilesDiagnostics
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

function prepareModel(root: Object3D): void {
  root.traverse((child) => {
    if (!('isMesh' in child)) return
    const mesh = child as Object3D & { castShadow: boolean; receiveShadow: boolean }
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}

export default function Phase1City({
  onBaseRegistered,
}: {
  onBaseRegistered?: (root: Group) => void
}) {
  const rendererRef = useRef<TilesRendererImpl | null>(null)
  const camera = useThree((state) => state.camera)
  const gameplayRef = useRef<Phase1GameplayTileSystem | null>(null)
  const runtimeRef = useRef<RuntimeSession | null>(null)
  const ownershipRef = useRef(new Phase1RuntimeOwnership())
  const readyFiredRef = useRef(false)
  const gameplayUpdateElapsed = useRef(0)
  const diagnosticsRef = useRef<Phase1Diagnostics>(initialDiagnostics())
  const [visualConfig, setVisualConfig] = useState<VisualRuntimeConfig | null>(null)
  const onBase = useRef(onBaseRegistered)
  onBase.current = onBaseRegistered

  const owns = useCallback((session: RuntimeSession): boolean => (
    ownershipRef.current.owns(session.lease) && runtimeRef.current === session
  ), [])

  const publish = useCallback((session: RuntimeSession): void => {
    if (!owns(session)) return
    publishDiagnostics(diagnosticsRef.current)
  }, [owns])

  const applyGate = useCallback((session: RuntimeSession): void => {
    if (!owns(session) || !session.gate) return
    const gate = session.gate.snapshot()
    const diagnostics = diagnosticsRef.current
    diagnostics.releaseVerified = gate.releaseVerified
    diagnostics.requiredVisualModels = gate.requiredTileIds.length
    diagnostics.loadedRequiredVisualModels = gate.loadedRequiredTileIds.length
    diagnostics.visibleRequiredVisualModels = gate.visibleRequiredTileIds.length
    diagnostics.terminalVisualErrors = gate.terminalVisualErrors
    diagnostics.enterable = gate.enterable
    if (gate.terminalVisualErrors > 0 || diagnostics.gameplayStatus === 'error') {
      diagnostics.status = 'error'
    } else {
      diagnostics.status = gate.enterable ? 'ready' : 'loading'
    }
    publish(session)
    if (!gate.enterable || readyFiredRef.current || !owns(session)) return
    const renderer = rendererRef.current
    if (!renderer) return
    readyFiredRef.current = true
    onBase.current?.(renderer.group)
  }, [owns, publish])

  const recordVisualFailure = useCallback((
    session: RuntimeSession,
    message: string,
    error: unknown,
  ): void => {
    if (!owns(session)) return
    console.error(message, error)
    const gate = session.gate
    if (gate) {
      gate.terminalVisualError()
      applyGate(session)
      return
    }
    const diagnostics = diagnosticsRef.current
    diagnostics.status = 'error'
    diagnostics.errors += 1
    diagnostics.terminalVisualErrors += 1
    diagnostics.enterable = false
    publish(session)
  }, [applyGate, owns, publish])

  // Put the camera inside the fixture's refinement volume before the first
  // TilesRenderer update. The legacy title camera is kilometres away and
  // points away from HQ, so an empty-content root would correctly refine to
  // zero visible leaves and the development route would look blank.
  useLayoutEffect(() => {
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('visionCapture') === '1'
    ) return
    camera.position.set(PHASE1_SPAWN.x, PHASE1_SPAWN.y + 1.7, PHASE1_SPAWN.z)
    camera.lookAt(PHASE1_HQ_WORLD.x, PHASE1_HQ_WORLD.y + 25, PHASE1_HQ_WORLD.z)
    camera.updateMatrixWorld(true)
  }, [camera])

  useEffect(() => {
    const ownership = ownershipRef.current
    const session: RuntimeSession = {
      lease: ownership.acquire(),
      controller: new AbortController(),
      gate: null,
    }
    runtimeRef.current = session
    readyFiredRef.current = false
    gameplayUpdateElapsed.current = 0
    diagnosticsRef.current = initialDiagnostics()
    publish(session)

    void (async () => {
      let release: Phase1Release
      try {
        release = await fetchPhase1Release(fetchJson, session.controller.signal, PHASE1_RELEASE_URL)
      } catch (error) {
        if (!session.controller.signal.aborted) {
          recordVisualFailure(session, '[phase1-city] release or tileset validation failed:', error)
        }
        return
      }
      if (!owns(session)) return

      const gate = new Phase1VisualGate(release.requiredInitialTileIds)
      gate.verifyRelease()
      session.gate = gate
      applyGate(session)
      setVisualConfig({ session, release })

      const gameplay = new Phase1GameplayTileSystem({
        manifestUrl: release.gameplayManifestUrl,
        expectedSourceHash: release.sourceHash,
        expectedNormalizedDerivationSha256: release.normalizedDerivationSha256,
        expectedTileIds: release.requiredInitialTileIds,
        onDiagnostics: (snapshot) => {
          if (!owns(session) || gameplayRef.current !== gameplay) return
          const diagnostics = diagnosticsRef.current
          diagnostics.gameplayStatus = snapshot.status
          diagnostics.residentGameplayTiles = snapshot.residentTileIds.length
          diagnostics.pendingGameplayTiles = snapshot.pendingTileIds.length
          diagnostics.colliders = snapshot.colliderCount
          diagnostics.errors = Math.max(diagnostics.errors, snapshot.errors)
          applyGate(session)
        },
      })
      gameplayRef.current = gameplay
      try {
        await gameplay.load(PHASE1_SPAWN)
      } catch (error) {
        if (!owns(session) || gameplayRef.current !== gameplay) return
        const diagnostics = diagnosticsRef.current
        diagnostics.status = 'error'
        diagnostics.errors = Math.max(1, diagnostics.errors + 1)
        publish(session)
        console.error('[phase1-city] gameplay pipeline failed:', error)
        return
      }
      if (!owns(session) || gameplayRef.current !== gameplay) return
      gate.setGameplayReady(true)
      applyGate(session)
    })()

    return () => {
      ownership.release(session.lease)
      session.controller.abort()
      const gameplay = gameplayRef.current
      if (gameplay) {
        gameplay.dispose()
        if (gameplayRef.current === gameplay) gameplayRef.current = null
      }
      if (runtimeRef.current === session) {
        runtimeRef.current = null
        rendererRef.current = null
        setVisualConfig((current) => current?.session === session ? null : current)
        clearDiagnostics()
      }
    }
  }, [applyGate, owns, publish, recordVisualFailure])

  const handleTilesetLoaded = useCallback((event: { tileset: unknown; url: string }) => {
    const config = visualConfig
    if (!config || !owns(config.session)) return
    try {
      validatePhase1Tileset(event.tileset, config.release)
      if (new URL(event.url, location.href).toString() !== config.release.tilesetUrl) {
        throw new Error('renderer tileset URL does not match the release descriptor')
      }
    } catch (error) {
      recordVisualFailure(config.session, '[phase1-city] renderer tileset validation failed:', error)
      return
    }
    const renderer = rendererRef.current
    if (!renderer) {
      recordVisualFailure(config.session, '[phase1-city] renderer disappeared before tileset load:', null)
      return
    }
    renderer.group.name = 'phase1-city'
    ;(window as Phase1Window).__phase1TilesRenderer = renderer
    applyGate(config.session)
  }, [applyGate, owns, recordVisualFailure, visualConfig])

  const handleModelLoaded = useCallback((event: { scene: Object3D; tile: unknown }) => {
    const config = visualConfig
    if (!config || !owns(config.session)) return
    prepareModel(event.scene)
    diagnosticsRef.current.loadedModels += 1
    config.session.gate?.modelLoaded(phase1TileId(event.tile))
    applyGate(config.session)
  }, [applyGate, owns, visualConfig])

  const handleModelDisposed = useCallback((event: { tile: unknown }) => {
    const config = visualConfig
    if (!config || !owns(config.session)) return
    diagnosticsRef.current.loadedModels = Math.max(0, diagnosticsRef.current.loadedModels - 1)
    config.session.gate?.modelDisposed(phase1TileId(event.tile))
    applyGate(config.session)
  }, [applyGate, owns, visualConfig])

  const handleVisibilityChange = useCallback((event: { tile: unknown; visible: boolean }) => {
    const config = visualConfig
    if (!config || !owns(config.session)) return
    diagnosticsRef.current.visibleModels = rendererRef.current?.visibleTiles.size ?? 0
    config.session.gate?.visibilityChanged(phase1TileId(event.tile), event.visible)
    applyGate(config.session)
  }, [applyGate, owns, visualConfig])

  const handleLoadError = useCallback((event: { error: Error; url: string | URL }) => {
    const config = visualConfig
    if (!config || !owns(config.session)) return
    diagnosticsRef.current.errors += 1
    recordVisualFailure(
      config.session,
      `[phase1-city] failed to load ${String(event.url)}:`,
      event.error,
    )
  }, [owns, recordVisualFailure, visualConfig])

  useFrame((_, delta) => {
    const gameplay = gameplayRef.current
    if (!gameplay || diagnosticsRef.current.gameplayStatus !== 'ready') return
    gameplayUpdateElapsed.current += delta
    if (gameplayUpdateElapsed.current < 0.25) return
    gameplayUpdateElapsed.current = 0
    void gameplay.update(rt.player.pos).catch((error: unknown) => {
      console.error('[phase1-city] gameplay tile update failed:', error)
    })
  })

  return (
    <>
      <color attach="background" args={['#7897b5']} />
      <ambientLight intensity={0.8} />
      <hemisphereLight color="#fff0d2" groundColor="#263343" intensity={2.1} />
      <directionalLight
        color="#ffd2a0"
        intensity={2.4}
        position={PHASE1_SUN_POSITION}
      />
      <mesh
        name="phase1-technical-ground"
        position={PHASE1_GROUND_POSITION}
        rotation={PHASE1_GROUND_ROTATION}
        receiveShadow
      >
        <planeGeometry args={[PHASE1_AOI_SIZE_METERS, PHASE1_AOI_SIZE_METERS]} />
        <meshStandardMaterial color="#68737e" roughness={0.94} metalness={0} />
      </mesh>
      {visualConfig && (
        <TilesRenderer
          ref={rendererRef}
          url={visualConfig.release.tilesetUrl}
          errorTarget={4}
          loadSiblings
          onLoadTileset={handleTilesetLoaded}
          onLoadModel={handleModelLoaded}
          onDisposeModel={handleModelDisposed}
          onTileVisibilityChange={handleVisibilityChange}
          onLoadError={handleLoadError}
        />
      )}
    </>
  )
}
