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
import { Canvas, useThree } from '@react-three/fiber'
import { PointerLockControls, useProgress } from '@react-three/drei'
import * as THREE from 'three'

import { useGame } from './adapter/store'
import { inputLocked, useHud } from './ui/hud-store'
import { ResilientResizeObserver } from './lib/resize'
import { GameLoop } from './gameplay/GameLoop'
import { rt, setRuntimePaused } from './gameplay/runtime'
import { PlayerAvatar } from './character/PlayerAvatar'
import { NightEnvironment } from './world/NightEnvironment'
import { ManhattanCity } from './world/ManhattanCity'
import { SkyRig } from './world/SkyRig'
import { ShadowBudget } from './world/ShadowBudget'
import { AtmosphericDust } from './world/AtmosphericDust'
import { resolveManhattanSpawn } from './world/manhattan-collision'
import { PALETTE, QUALITY } from './world/palette'
import { Hud } from './ui/Hud'
import { DevMenu } from './ui/DevMenu'
import { DevSpawns } from './ui/DevSpawns'
import { IntroCamera, IntroSequence } from './ui/IntroSequence'
import { DEFAULT_SETTINGS, LoadingScreen, PauseMenu, TitleScreen, type Settings } from './ui/Screens'
import { loadGame, saveGame, type SaveData } from './gameplay/save'
import { cityAudio } from './audio'
import { isDevInspection } from './gameplay/dev-view'
import { visionCaptureSpec, visionFeet } from './gameplay/vision-capture'

function currentSaveData(settings: Settings): SaveData {
  return {
    pos: { ...rt.player.pos },
    forward: { ...rt.player.forward },
    settings: { quality: settings.quality, sensitivity: settings.sensitivity, fov: settings.fov, volume: settings.volume },
  }
}

function applySave(data: SaveData): void {
  rt.player.pos = { ...data.pos }
  rt.player.forward = { ...data.forward }
  rt.player.velocityY = 0
}

const PostProcessing = lazy(() => import('./world/PostProcessing'))

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
      <SkyRig quality={quality} />
      <ShadowBudget enabled={quality.shadows} mapSize={quality.shadowMapSize} />

      {/* The one world: the streamed Manhattan island. */}
      <ManhattanCity mode="tiles" onBaseRegistered={onBaseRegistered} />

      <PlayerAvatar />
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
 * Decides when the world is ready to enter: the loader must be idle AND the
 * Manhattan base (the island surface we spawn on) must be registered.
 */
function LoadGate({ baseReady, onReady }: { baseReady: boolean; onReady(): void }) {
  const { progress, active } = useProgress()
  const fired = useRef(false)

  const fire = useCallback(() => {
    if (fired.current) return
    fired.current = true
    // Deferred so a component that resolves from Suspense in the same frame
    // (the player model, say) never sees a setState during its own render.
    setTimeout(onReady, 0)
  }, [onReady])

  useEffect(() => {
    if (baseReady && !active && progress >= 100) {
      fire()
      return
    }
    const id = setTimeout(fire, 1200)
    return () => clearTimeout(id)
  }, [baseReady, active, progress, fire])

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
    quality: DEFAULT_SETTINGS.quality,
  }))
  const vision = useMemo(
    () => visionCaptureSpec(typeof location === 'undefined' ? '' : location.search),
    [],
  )
  const [ready, setReady] = useState(false)
  const [baseReady, setBaseReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [introActive, setIntroActive] = useState(false)
  const controls = useRef<{ lock(): void; unlock(): void } | null>(null)
  const bootStartedAt = useRef(window.performance.now()).current
  const spawnResolved = useRef(false)
  const markSceneReady = useCallback(() => {
    document.documentElement.dataset.initialLoadMs = (
      window.performance.now() - bootStartedAt
    ).toFixed(1)
    setReady(true)
  }, [bootStartedAt])

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

  // Apply the restored world state once (unless a capture/QA mode overrode it).
  useEffect(() => {
    if (vision || visualInspection) return
    if (!spawnResolved.current) return
    if (restored.fault && restored.fault !== 'empty') {
      console.warn(`[save] ${restored.fault} — starting a fresh run`)
    } else if (restored.repaired.length > 0) {
      console.warn(`[save] repaired: ${restored.repaired.join(', ')}`)
    }
    if (!restored.data.forward.x && !restored.data.forward.z) return
    applySave(restored.data)
  }, [restored, visualInspection, vision])

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

  const enterWorld = useCallback(() => {
    setScreen('playing')
    setIntroActive(true)
    if (pointerLockEnabled && document.hasFocus()) controls.current?.lock()
    void cityAudio.start()
  }, [pointerLockEnabled, setScreen])

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
          <LoadGate baseReady={baseReady} onReady={markSceneReady} />
        </Suspense>
        {pointerLockEnabled && (
          <PointerLockControls
            ref={controls as never}
            pointerSpeed={settings.sensitivity}
            onUnlock={() => {
              if (useHud.getState().screen === 'playing') setScreen('paused')
            }}
          />
        )}
      </Canvas>

      {screen === 'playing' && <Hud />}
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
