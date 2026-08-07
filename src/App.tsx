/**
 * Assembly: canvas, scene graph, overlays, and the screen state machine.
 *
 * One world now: the streamed Manhattan island. The old headquarters build
 * (lobby, elevator, office floors, plaza) is retired — this is the whole game.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls, useProgress } from '@react-three/drei'
import * as THREE from 'three'

import { useGame } from './adapter/store'
import { inputLocked, useHud } from './ui/hud-store'
import { ResilientResizeObserver } from './lib/resize'
import { GameLoop } from './gameplay/GameLoop'
import { DragLook } from './gameplay/DragLook'
import { rt, setRuntimePaused } from './gameplay/runtime'
import { PlayerAvatar } from './character/PlayerAvatar'
import { VehicleRig } from './world/VehicleRig'
import { NightEnvironment } from './world/NightEnvironment'
import { ManhattanCity } from './world/ManhattanCity'
import { DayCycle } from './world/DayCycleRig'
import { CityLightingRig } from './world/CityLightingRig'
import { ShadowBudget } from './world/ShadowBudget'
import { AtmosphericDust } from './world/AtmosphericDust'
import { resolveManhattanSpawn } from './world/manhattan-collision'
import { PALETTE, QUALITY } from './world/palette'
import { Hud } from './ui/Hud'
import { DevMenu } from './ui/DevMenu'
import { DevSpawns } from './ui/DevSpawns'
import { IntroCamera, IntroSequence } from './ui/IntroSequence'
import { LoadingScreen, PauseMenu, TitleScreen, type Settings } from './ui/Screens'
import { loadGame, saveGame, type SaveData } from './gameplay/save'
import { cityAudio } from './audio'
import { isDevInspection } from './gameplay/dev-view'
import { visionCaptureSpec, visionFeet, VISION_CAMERA_DATASET_KEY, VISION_READY_DATASET_KEY, type VisionCaptureSpec } from './gameplay/vision-capture'
import { snapshotOwnedVehicle, restoreOwnedVehicle, vehicleSim } from './gameplay/vehicles/vehicle-session'

function currentSaveData(settings: Settings): SaveData {
  return {
    pos: { ...rt.player.pos },
    forward: { ...rt.player.forward },
    settings: { quality: settings.quality, sensitivity: settings.sensitivity, fov: settings.fov, volume: settings.volume },
    vehicle: snapshotOwnedVehicle(vehicleSim),
  }
}

function applySave(data: SaveData): void {
  rt.player.pos = { ...data.pos }
  rt.player.forward = { ...data.forward }
  rt.player.velocityY = 0
  restoreOwnedVehicle(vehicleSim, data.vehicle)
}

const PostProcessing = lazy(() => import('./world/PostProcessing'))

/** How often LoadGate samples the loader store. */
const LOAD_GATE_POLL_MS = 100

/** Hands the renderer to the perf overlay and applies quality settings. */
function RendererBridge({ maxDpr, shadows }: { maxDpr: number; shadows: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const setDpr = useThree((s) => s.setDpr)

  useEffect(() => {
    ;(window as { __gameRenderer?: THREE.WebGLRenderer }).__gameRenderer = gl
    ;(window as { __gameScene?: THREE.Scene }).__gameScene = scene
    gl.shadowMap.enabled = shadows
    gl.shadowMap.type = THREE.PCFShadowMap
    setDpr(Math.min(window.devicePixelRatio, maxDpr))
    return () => {
      delete (window as { __gameRenderer?: THREE.WebGLRenderer }).__gameRenderer
      delete (window as { __gameScene?: THREE.Scene }).__gameScene
    }
  }, [gl, scene, maxDpr, shadows, setDpr])

  return null
}

function Scene({
  settings,
  onBaseRegistered,
}: {
  settings: Settings
  onBaseRegistered(): void
}) {

  const quality = QUALITY[settings.quality]

  return (
    <>
      <color attach="background" args={[PALETTE.night]} />

      <NightEnvironment />

      <RendererBridge maxDpr={quality.maxDpr} shadows={quality.shadows} />
      <DayCycle />
      <CityLightingRig quality={settings.quality} />
      <ShadowBudget enabled={quality.shadows} mapSize={quality.shadowMapSize} />

      {/* The one world: the streamed Manhattan island. */}
      <ManhattanCity mode="tiles" quality={settings.quality} onBaseRegistered={onBaseRegistered} />

      <PlayerAvatar />
      <VehicleRig />
      <DevSpawns />
      <AtmosphericDust />
      <IntroCamera />

      <GameLoop />

      {quality.postprocessing && (
        <Suspense fallback={null}>
          <PostProcessing />
        </Suspense>
      )}
    </>
  )
}

/**
 * Capture-bridge instrumentation for the visual QA pipeline.
 *
 * In a ?visionCapture session the runner needs two facts from the page: that
 * the world is mounted and the settled camera pose. Both are published as DOM
 * dataset attributes (the same channel the perf/avatar overlays use); in a
 * normal session this component renders null and changes nothing.
 */
function VisionBridge({ vision }: { vision: VisionCaptureSpec | null }) {
  const camera = useThree((s) => s.camera)
  const lastPublish = useRef(0)
  const dir = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!vision) return
    const now = performance.now()
    if (now - lastPublish.current < 500) return
    lastPublish.current = now
    camera.getWorldDirection(dir.current)
    const p = camera.position
    document.documentElement.dataset[VISION_CAMERA_DATASET_KEY] =
      `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},` +
      `${dir.current.x.toFixed(4)},${dir.current.y.toFixed(4)},${dir.current.z.toFixed(4)}`
  })

  return null
}

/**
 * Decides when the world is ready to enter: the loader must be idle AND the
 * Manhattan base (the island surface we spawn on) must be registered.
 */
function LoadGate({ baseReady, onReady }: { baseReady: boolean; onReady(): void }) {
  const fired = useRef(false)

  const fire = useCallback(() => {
    if (fired.current) return
    fired.current = true
    // Deferred so a component that resolves from Suspense in the same frame
    // (the player model, say) never sees a setState during its own render.
    setTimeout(onReady, 0)
  }, [onReady])

  // Read the loader store imperatively rather than subscribing to it.
  //
  // useProgress() is backed by three's LoadingManager, which writes to the
  // store *synchronously* as each asset resolves. A subscriber is therefore
  // scheduled for update in the middle of whichever sibling happened to
  // resolve — in practice RealisticPlayer settling its glTF — and React
  // reports that as "Cannot update a component (LoadGate) while rendering a
  // different component (RealisticPlayer)". Polling sidesteps it entirely;
  // this gate only needs to notice readiness within a frame or two.
  useEffect(() => {
    const check = () => {
      const { progress, active } = useProgress.getState()
      if (baseReady && !active && progress >= 100) fire()
    }
    check()
    const poll = setInterval(check, LOAD_GATE_POLL_MS)
    const fallback = setTimeout(fire, 1200)
    return () => {
      clearInterval(poll)
      clearTimeout(fallback)
    }
  }, [baseReady, fire])

  return null
}

export default function App() {
  const visualInspection =
    typeof location !== 'undefined' && isDevInspection(location.search, import.meta.env.DEV)
  const pointerLockEnabled =
    typeof location === 'undefined' ||
    new URLSearchParams(location.search).get('no-pointer-lock') !== '1'
  const screen = useHud((s) => s.screen)
  const setScreen = useHud((s) => s.setScreen)
  const start = useGame((s) => s.start)
  const dispose = useGame((s) => s.dispose)
  const setGamePaused = useGame((s) => s.setPaused)

  const restored = useRef(loadGame()).current

  const [settings, setSettings] = useState<Settings>(() => ({
    ...restored.data.settings,
  }))
  const vision = useMemo(
    () => visionCaptureSpec(typeof location === 'undefined' ? '' : location.search),
    [],
  )

  // Deterministic captures: the life sims must never run, so the freeze goes
  // in before anything mounts, not when the base happens to register.
  useEffect(() => {
    if (vision) rt.captureFrozen = true
  }, [vision])
  const [ready, setReady] = useState(false)
  const [baseReady, setBaseReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [introActive, setIntroActive] = useState(false)
  // Set once the browsing context refuses pointer lock; from then on the game
  // runs in drag-to-look rather than retrying a lock that cannot succeed.
  const [pointerLockBlocked, setPointerLockBlocked] = useState(false)
  const controls = useRef<{ lock(): void; unlock(): void } | null>(null)
  const bootStartedAt = useRef(window.performance.now()).current
  const spawnResolved = useRef(false)
  const markSceneReady = useCallback(() => {
    document.documentElement.dataset.initialLoadMs = (
      window.performance.now() - bootStartedAt
    ).toFixed(1)
    if (vision) document.documentElement.dataset[VISION_READY_DATASET_KEY] = '1'
    setReady(true)
  }, [bootStartedAt, vision])

  // Resolve the player's spawn the moment the island surface is registered,
  // so the camera and avatar never stand on water.
  const handleBaseRegistered = useCallback(() => {
    if (spawnResolved.current) return
    spawnResolved.current = true
    const spawn = resolveManhattanSpawn()
    rt.player.pos = spawn
    rt.player.velocityY = 0
    rt.player.grounded = true
    if (vision) {
      rt.player.pos = visionFeet(vision)
      rt.player.velocityY = 0
      rt.player.forward = { x: 0, z: -1 }
      rt.clock.hour = vision.time
      rt.clock.rainTarget = vision.rain
      rt.clock.weather = { rain: vision.rain, wetness: vision.rain >= 0.5 ? 1 : 0 }
      // Pinned clock: repeated captures of the same scene must be identical.
      // (captureFrozen is also set at mount, before any sim can run, so the
      // traffic and crowd start frozen rather than freezing mid-drive.)
      rt.captureFrozen = true
      document.documentElement.classList.add('vision-capture')
    }
    setBaseReady(true)
  }, [vision])

  useLayoutEffect(() => {
    const paused = inputLocked(screen)
    setRuntimePaused(paused)
    setGamePaused(paused)
    const audioEnabled = screen === 'playing'
    cityAudio.setEnabled(audioEnabled)
  }, [screen, setGamePaused])

  useEffect(() => {
    const pauseOnEscape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || useHud.getState().screen !== 'playing') return
      controls.current?.unlock()
      setScreen('paused')
    }
    window.addEventListener('keydown', pauseOnEscape)
    return () => window.removeEventListener('keydown', pauseOnEscape)
  }, [setScreen])

  useEffect(() => {
    start()
    return () => dispose()
  }, [start, dispose])

  useEffect(() => {
    cityAudio.setMasterVolume(settings.volume)
  }, [settings.volume])

  useEffect(() => {
    document.documentElement.dataset.qualityPreset = settings.quality
    return () => {
      delete document.documentElement.dataset.qualityPreset
    }
  }, [settings.quality])

  // Apply the restored world state once the spawn has resolved (the base
  // registration is async, so this effect re-runs when baseReady flips).
  useEffect(() => {
    if (vision || visualInspection) return
    if (!baseReady || !spawnResolved.current) return
    if (restored.fault && restored.fault !== 'empty') {
      console.warn(`[save] ${restored.fault} — starting a fresh run`)
    } else if (restored.repaired.length > 0) {
      console.warn(`[save] repaired: ${restored.repaired.join(', ')}`)
    }
    if (!restored.data.forward.x && !restored.data.forward.z) return
    applySave(restored.data)
  }, [restored, baseReady, visualInspection, vision])

  useEffect(() => {
    if (visualInspection || vision) return
    const snapshot = () => saveGame(currentSaveData(settings))
    const id = setInterval(snapshot, 5000)
    window.addEventListener('pagehide', snapshot)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', snapshot)
      snapshot()
    }
  }, [settings, visualInspection, vision])

  // Fake progress so the loading card never sits frozen on a fast machine.
  useEffect(() => {
    if (ready) return
    const id = setInterval(() => setProgress((p) => Math.min(0.92, p + 0.08)), 90)
    return () => clearInterval(id)
  }, [ready])

  useEffect(() => {
    if (ready && baseReady && screen === 'loading') {
      setScreen(visualInspection || vision ? 'playing' : 'title')
    }
  }, [ready, baseReady, screen, setScreen, visualInspection, vision])

  // Enter the world, and only claim to have entered if the pointer actually
  // locked.
  //
  // requestPointerLock rejects in contexts that are not a valid top-level
  // document — an embedded preview pane is one — and the old path ignored
  // that: the screen flipped to 'playing', the audio graph started, the lock
  // silently failed, and PointerLockControls' unlock handler put the pause
  // menu straight back. What the player got was a menu that would not go away
  // and a burst of city ambience on every click.
  //
  // Mouselook is not worth blocking play over. A refused lock drops
  // PointerLockControls so nothing can bounce the screen back to paused, and
  // DragLook takes over: hold the left button and drag. The HUD says so rather
  // than leaving it a mystery.
  const enterWorld = useCallback(() => {
    const canLock = pointerLockEnabled && !pointerLockBlocked
    if (canLock && document.hasFocus()) {
      const done = (locked: boolean) => {
        if (locked) return
        setPointerLockBlocked(true)
        console.warn(
          '[input] pointer lock refused by this browsing context; ' +
            'keyboard movement only until this page is opened in a ' +
            'top-level browser window',
        )
      }
      try {
        const result = controls.current?.lock() as unknown
        if (result instanceof Promise) {
          result.then(() => done(true)).catch(() => done(false))
        } else {
          // three's older lock() is synchronous and reports nothing, so ask
          // the document on the next tick instead
          setTimeout(() => done(document.pointerLockElement != null), 0)
        }
      } catch {
        done(false)
      }
    }
    setScreen('playing')
    setIntroActive(true)
    void cityAudio.start()
  }, [pointerLockEnabled, pointerLockBlocked, setScreen])

  return (
    <>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: vision?.fov ?? settings.fov, near: 0.1, far: 30000, position: [400, 433, 660] }}
        resize={{ polyfill: ResilientResizeObserver as unknown as typeof ResizeObserver }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 0.72
        }}
      >
        <Suspense fallback={null}>
          <Scene settings={settings} onBaseRegistered={handleBaseRegistered} />
          <VisionBridge vision={vision} />
          <LoadGate baseReady={baseReady} onReady={markSceneReady} />
        </Suspense>
        {pointerLockEnabled && !pointerLockBlocked && (
          <PointerLockControls
            ref={controls as never}
            pointerSpeed={settings.sensitivity}
            onUnlock={() => {
              if (useHud.getState().screen === 'playing') setScreen('paused')
            }}
          />
        )}
        {/* Whenever pointer lock is not doing the job, drag-to-look is. */}
        <DragLook
          enabled={(!pointerLockEnabled || pointerLockBlocked) && screen === 'playing'}
          sensitivity={settings.sensitivity}
        />
      </Canvas>

      {screen === 'playing' && <Hud />}
      {screen === 'playing' && pointerLockBlocked && (
        <div className="input-notice" role="status">
          This page can’t capture the pointer — <strong>hold the left mouse
          button and drag to look</strong>. Open it in its own browser window
          for normal mouselook.
        </div>
      )}
      {introActive && screen === 'playing' && !vision && !visualInspection && (
        <IntroSequence
          onDone={() => {
            setIntroActive(false)
          }}
        />
      )}
      {screen === 'playing' && <DevMenu />}
      {screen === 'loading' && <LoadingScreen progress={progress} />}
      {screen === 'title' && <TitleScreen onStart={enterWorld} />}
      {screen === 'paused' && (
        <PauseMenu settings={settings} onChange={setSettings} onResume={enterWorld} />
      )}
    </>
  )
}
