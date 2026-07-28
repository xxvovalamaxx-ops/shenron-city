/**
 * Assembly: canvas, scene graph, overlays, and the screen state machine that
 * decides who owns the mouse.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PointerLockControls, useProgress } from '@react-three/drei'
import * as THREE from 'three'

import { useGame } from './adapter/store'
import { useHud } from './ui/hud-store'
import { ResilientResizeObserver } from './lib/resize'
import { GameLoop } from './gameplay/GameLoop'
import type { Interactable } from './gameplay/interact'
import { rt } from './gameplay/runtime'
import { step as stepElevator } from './gameplay/elevator'
import { Exterior } from './world/Exterior'
import { Lobby } from './world/Lobby'
import { Elevator } from './world/Elevator'
import { Floor45 } from './world/Floor45'
import { DoorPair } from './world/Doors'
import { Secretary, SECRETARY_NAME } from './agents/Secretary'
import { AmbientCrowd } from './agents/AmbientCrowd'
import { MarketKeeper } from './agents/MarketKeeper'
import { PlazaWarden } from './agents/PlazaWarden'
import type { CharacterId } from './agents/dialogue'
import { ENTRANCE, HQ, OFFICE_SLOTS, PANEL, SECRETARY as SEC_POS, SPAWN } from './world/layout'
import { MARKET_KEEPER, PLAZA_WARDEN } from './world/city-data'
import { PALETTE, QUALITY } from './world/palette'
import { Hud } from './ui/Hud'
import { Dialogue } from './ui/Dialogue'
import { PlayerAvatar } from './character/PlayerAvatar'
import { LaserBeam } from './weapons/LaserBeam'
import { DestructionSystem } from './destruction/DestructionSystem'
import { NightEnvironment } from './world/NightEnvironment'
import { ShadowBudget } from './world/ShadowBudget'
import { AtmosphericDust } from './world/AtmosphericDust'
import { Capybara } from './animals/CapybaraActor'

import { OfficePanel } from './ui/OfficePanel'
import { DEFAULT_SETTINGS, LoadingScreen, PauseMenu, TitleScreen, type Settings } from './ui/Screens'
import { floorAtPosition, loadGame, saveGame, type SaveData } from './gameplay/save'
import { initialElevator } from './gameplay/elevator'
import { cityAudio } from './audio'
import { isDevInspection } from './gameplay/dev-view'

/** Slow enough to be free, often enough that a crash costs little progress. */
const SAVE_INTERVAL_MS = 5000

/**
 * Bridge between the save file and live state.
 *
 * Lives here rather than in gameplay/save.ts because it needs the HUD store,
 * and gameplay/ deliberately depends on nothing from the UI layer.
 */
function currentSaveData(settings: Settings): SaveData {
  return {
    pos: { ...rt.player.pos },
    forward: { ...rt.player.forward },
    tour: useHud.getState().cityTour,
    settings: { quality: settings.quality, sensitivity: settings.sensitivity, fov: settings.fov, volume: settings.volume },
  }
}

function applySave(data: SaveData): void {
  rt.player.pos = { ...data.pos }
  rt.player.forward = { ...data.forward }
  rt.player.velocityY = 0
  // Derived, never stored: a persisted floor could contradict the position and
  // drop the player down the shaft.
  rt.elevator = initialElevator(floorAtPosition(data.pos))
  useHud.setState({ cityTour: data.tour })
}

const PostProcessing = lazy(() => import('./world/PostProcessing'))

/** Hands the renderer to the perf overlay and applies quality settings. */
function RendererBridge({ maxDpr, shadows }: { maxDpr: number; shadows: boolean }) {
  const gl = useThree((s) => s.gl)
  const setDpr = useThree((s) => s.setDpr)

  useEffect(() => {
    ;(window as { __gameRenderer?: THREE.WebGLRenderer }).__gameRenderer = gl
    gl.shadowMap.enabled = shadows
    gl.shadowMap.type = THREE.PCFShadowMap
    setDpr(Math.min(window.devicePixelRatio, maxDpr))
    return () => {
      delete (window as { __gameRenderer?: THREE.WebGLRenderer }).__gameRenderer
    }
  }, [gl, maxDpr, shadows, setDpr])

  return null
}

/**
 * Three layers: ambient so nothing is ever pure black, a moon key for the
 * plaza's shadows, and practicals inside.
 *
 * Point-light intensities are candela with 1/d² falloff. The first pass used
 * values in the tens and the entire building rendered near-black — at 8 m a
 * light of intensity 26 contributes almost nothing. Anything lighting a room
 * belongs in the hundreds.
 */
function Lighting({ shadows, shadowMapSize }: { shadows: boolean; shadowMapSize: number }) {
  return (
    <>
      {/*
        Key-to-fill is what makes this read as night rather than as daylight
        with a black sky. It was hemisphere 0.55 + ambient 0.18 + environment
        0.32 against a 0.9 key — roughly 1:1, so every façade of every building
        received the same light and the geometry lost all form.

        Now about 5:1. Total illumination is close to what it was, but it
        arrives from one direction, so surfaces facing the moon are bright and
        the rest fall away to the city's own practicals.
      */}
      <hemisphereLight args={[PALETTE.horizon, '#0d1420', 0.2]} />
      <ambientLight intensity={0.07} color={PALETTE.coolLight} />

      {/* Moon key, casting the plaza's long shadows */}
      <directionalLight
        position={[38, 60, 34]}
        intensity={1.12}
        color="#c3d6f5"
        castShadow={shadows}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-near={1}
        shadow-camera-far={320}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-bias={-0.0006}
      />

      {/* Cool fill from the opposite side so shadowed faces keep their form */}
      <directionalLight position={[-30, 26, 28]} intensity={0.16} color="#7f9dd0" />

      {/* Warm spill from the lobby, out through the glass onto the plaza —
          this is what makes the entrance read as somewhere worth walking in. */}
      <pointLight
        position={[0, 4.2, -4]}
        color={PALETTE.warmLight}
        intensity={185}
        distance={34}
        decay={2}
      />
      <pointLight
        position={[0, 3.4, 7]}
        color={PALETTE.warmLight}
        intensity={80}
        distance={22}
        decay={2}
      />
    </>
  )
}

function Scene({
  settings,
  onInteract,
}: {
  settings: Settings
  onInteract(t: Interactable): void
}) {
  const snapshot = useGame((s) => s.snapshot)
  const quality = QUALITY[settings.quality]
  const agents = useMemo(() => snapshot?.agents ?? [], [snapshot?.agents])

  // Interaction points. Rebuilt only when the agent roster changes — this is
  // not per-frame data.
  const interactables = useMemo<Interactable[]>(() => {
    const list: Interactable[] = [
      {
        id: 'secretary',
        kind: 'secretary',
        x: SEC_POS.x,
        y: 1.5,
        z: SEC_POS.z + 1.2,
        label: `Talk to ${SECRETARY_NAME}`,
        range: 3.6,
      },
      {
        id: 'panel',
        kind: 'elevator-panel',
        x: PANEL.x,
        y: PANEL.y,
        z: PANEL.z,
        label: 'Use the elevator',
        range: 2.4,
        payload: 'car',
        movingY: PANEL.y,
      },
      {
        id: 'city-character-mira',
        kind: 'city-character',
        x: MARKET_KEEPER.x,
        y: 1.45,
        z: MARKET_KEEPER.z,
        label: `Talk to ${MARKET_KEEPER.name}`,
        range: 3.4,
        payload: MARKET_KEEPER.id,
      },
      {
        id: 'city-character-kai',
        kind: 'city-character',
        x: PLAZA_WARDEN.x,
        y: 1.45,
        z: PLAZA_WARDEN.z,
        label: `Talk to ${PLAZA_WARDEN.name}`,
        range: 3.4,
        payload: PLAZA_WARDEN.id,
      },
    ]

    for (const slot of OFFICE_SLOTS) {
      const agent = agents[slot.index]
      if (!agent) continue
      list.push({
        id: `office-${agent.id}`,
        kind: 'agent-office',
        x: slot.x,
        y: HQ.y + 1.5,
        z: slot.z,
        label: `Inspect ${agent.name}`,
        range: 4.2,
        payload: agent.id,
      })
    }

    return list
  }, [agents])

  return (
    <>
      <color attach="background" args={[PALETTE.night]} />
      {/* The hero boulevard stays readable from spawn while the far skyline
          still dissolves into the night horizon. */}
      <fog attach="fog" args={[PALETTE.horizon, 145, 480]} />

      <NightEnvironment />

      <RendererBridge maxDpr={quality.maxDpr} shadows={quality.shadows} />
      <Lighting shadows={quality.shadows} shadowMapSize={quality.shadowMapSize} />
      <ShadowBudget enabled={quality.shadows} mapSize={quality.shadowMapSize} />

      <Exterior quality={quality} />
      <Lobby quality={quality} />
      <Elevator />
      <Floor45 agents={agents} quality={quality} source={snapshot?.source ?? 'standalone'} />
      <Secretary />
      <MarketKeeper />
      <PlazaWarden />
      <AmbientCrowd count={quality.ambientPedestrians} />
      {/* The high-detail animal starts loading with the scene but does not
          hold the title screen hostage on a cold cache. */}
      <Suspense fallback={null}>
        <Capybara shadows={quality.shadows} />
      </Suspense>

      <PlayerAvatar />
      <LaserBeam />
      <DestructionSystem />
      <AtmosphericDust />

      {/* Entrance doors live outside the car group — they do not travel */}
      <DoorPair
        halfWidth={ENTRANCE.halfWidth}
        height={ENTRANCE.height}
        z={ENTRANCE.z}
        leftRef={(g) => {
          rt.refs.entranceLeft = g
        }}
        rightRef={(g) => {
          rt.refs.entranceRight = g
        }}
      />

      <GameLoop
        interactables={interactables}
        ambientPedestrians={quality.ambientPedestrians}
        onInteract={onInteract}
      />

      {quality.postprocessing && (
        <Suspense fallback={null}>
          <PostProcessing />
        </Suspense>
      )}
    </>
  )
}

/**
 * Decides when the world is ready to enter.
 *
 * `useProgress` tracks both route-critical files and optional models behind
 * nested Suspense boundaries. Waiting for every optional high-detail model
 * would make a 4–6 MB character hold the title screen hostage even though its
 * reviewed fallback can already render.
 *
 * The outer Suspense boundary guarantees this component does not mount until
 * route-critical files are ready. Once mounted, finish immediately if the
 * loader is idle or after a short settlement window while optional assets
 * continue in their local boundaries.
 */
function LoadGate({ onReady }: { onReady(): void }) {
  const { progress, active } = useProgress()
  const fired = useRef(false)

  const fire = useCallback(() => {
    if (fired.current) return
    fired.current = true
    onReady()
  }, [onReady])

  useEffect(() => {
    if (!active && progress >= 100) {
      fire()
      return
    }
    const id = setTimeout(fire, 700)
    return () => clearTimeout(id)
  }, [active, progress, fire])

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
  const openAgentId = useHud((s) => s.openAgentId)
  const openCharacterId = useHud((s) => s.openCharacterId)
  const start = useGame((s) => s.start)
  const dispose = useGame((s) => s.dispose)

  // Read the save once, before first paint, so the world is never built at the
  // spawn and then visibly snapped to the restored position a frame later.
  const restored = useRef(loadGame()).current

  const [settings, setSettings] = useState<Settings>(() => ({
    ...restored.data.settings,
    // A ?quality= in the URL is an explicit instruction for this run and
    // outranks whatever the last session happened to be playing at.
    quality: DEFAULT_SETTINGS.quality,
  }))
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const controls = useRef<{ lock(): void; unlock(): void } | null>(null)
  const bootStartedAt = useRef(window.performance.now()).current
  const markSceneReady = useCallback(() => {
    document.documentElement.dataset.initialLoadMs = (
      window.performance.now() - bootStartedAt
    ).toFixed(1)
    setReady(true)
  }, [bootStartedAt])

  useEffect(() => {
    const target = window as Window & {
      __cityAudioDiagnostics?: typeof cityAudio.diagnostics
    }
    target.__cityAudioDiagnostics = () => cityAudio.diagnostics()
    const publish = () => {
      const diagnostics = cityAudio.diagnostics()
      const root = document.documentElement
      root.dataset.audioState = diagnostics.state
      root.dataset.audioSampleRate = String(diagnostics.sampleRate)
      root.dataset.audioLeftRms = diagnostics.leftRms.toFixed(6)
      root.dataset.audioRightRms = diagnostics.rightRms.toFixed(6)
      root.dataset.audioStereoDifference = diagnostics.stereoDifference.toFixed(6)
    }
    publish()
    const interval = window.setInterval(publish, 250)
    return () => {
      window.clearInterval(interval)
      delete target.__cityAudioDiagnostics
      for (const key of [
        'audioState',
        'audioSampleRate',
        'audioLeftRms',
        'audioRightRms',
        'audioStereoDifference',
      ] as const) {
        delete document.documentElement.dataset[key]
      }
    }
  }, [])

  useEffect(() => {
    start()
    return () => dispose()
  }, [start, dispose])

  // Apply volume changes to the audio engine.
  useEffect(() => {
    cityAudio.setMasterVolume(settings.volume)
  }, [settings.volume])

  useEffect(() => {
    document.documentElement.dataset.qualityPreset = settings.quality
    return () => {
      delete document.documentElement.dataset.qualityPreset
    }
  }, [settings.quality])

  // Apply the restored world state once. The elevator floor is derived from
  // the position rather than stored, so the two can never contradict.
  useEffect(() => {
    if (visualInspection) {
      rt.elevator = initialElevator(floorAtPosition(rt.player.pos))
    } else {
      applySave(restored.data)
    }
    if (restored.fault && restored.fault !== 'empty') {
      console.warn(`[save] ${restored.fault} — starting a fresh run`)
    } else if (restored.repaired.length > 0) {
      console.warn(`[save] repaired: ${restored.repaired.join(', ')}`)
    }
  }, [restored, visualInspection])

  // Persist on a slow timer and on the way out. One small JSON.stringify.
  useEffect(() => {
    if (visualInspection) return
    const snapshot = () => saveGame(currentSaveData(settings))
    const id = setInterval(snapshot, SAVE_INTERVAL_MS)
    window.addEventListener('pagehide', snapshot)
    return () => {
      clearInterval(id)
      window.removeEventListener('pagehide', snapshot)
      snapshot()
    }
  }, [settings, visualInspection])


  // Fake a little progress so the loading card is not a frozen empty bar on a
  // fast machine; the real gate is LoadGate.
  useEffect(() => {
    if (ready) return
    const id = setInterval(() => setProgress((p) => Math.min(0.92, p + 0.08)), 90)
    return () => clearInterval(id)
  }, [ready])

  useEffect(() => {
    if (ready && screen === 'loading') setScreen(visualInspection ? 'playing' : 'title')
  }, [ready, screen, setScreen, visualInspection])

  const enterWorld = useCallback(() => {
    setScreen('playing')
    // Both of these need the user gesture we are currently inside: browsers
    // refuse pointer lock without one, and refuse to start an AudioContext.
    // A remote/non-focused validation tab can deliver the click while its
    // document is not eligible for pointer lock. In that case keep the world
    // running and avoid turning an expected host limitation into a console
    // error; a real focused gameplay click still locks normally.
    if (pointerLockEnabled && document.hasFocus()) controls.current?.lock()
    void cityAudio.start()
  }, [pointerLockEnabled, setScreen])

  const onInteract = useCallback(
    (target: Interactable) => {
      switch (target.kind) {
        case 'secretary':
          controls.current?.unlock()
          useHud.setState({ openCharacterId: 'iris' })
          useHud.getState().advanceCityTour('TALK_IRIS')
          setScreen('dialogue')
          break
        case 'city-character': {
          // Only characters with a dialogue profile are talkable.
          const who = target.payload
          if (who !== 'mira' && who !== 'kai') break
          controls.current?.unlock()
          useHud.setState({ openCharacterId: who as CharacterId })
          // Kai is optional colour on the route; only Mira advances the tour.
          if (who === 'mira') useHud.getState().advanceCityTour('TALK_MIRA')
          setScreen('dialogue')
          break
        }
        case 'elevator-panel': {
          // Pressing the panel calls the floor you are not on. The machine
          // itself decides whether that is legal right now.
          const here = rt.elevator.phase === 'travelling' ? null : rt.elevator.floor
          const wanted = here === 'hq' ? 'lobby' : 'hq'
          rt.elevator = stepElevator(rt.elevator, { type: 'CALL', floor: wanted })
          break
        }
        case 'agent-office':
          if (!target.payload) break
          controls.current?.unlock()
          useHud.setState({ openAgentId: target.payload })
          useHud.getState().advanceCityTour('INSPECT_OFFICE')
          setScreen('office')
          break
      }
    },
    [setScreen],
  )

  return (
    <>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{
          fov: settings.fov,
          near: 0.1,
          far: 900,
          position: [SPAWN.x, SPAWN.y + 1.65, SPAWN.z],
        }}
        // See lib/resize.ts — without this the canvas never gets measured on
        // hosts whose ResizeObserver never fires, and the game hangs on the
        // loading screen with no error.
        resize={{ polyfill: ResilientResizeObserver as unknown as typeof ResizeObserver }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          // Applies on the low preset only. From medium up, EffectComposer
          // takes tone mapping off the renderer (gl.toneMapping reads back as
          // NoToneMapping) and world/PostProcessing.tsx runs ACES itself, so
          // this value is inert there. Grading therefore lives in the light
          // rig, which every preset shares — changing it here would only make
          // low darker than high.
          gl.toneMappingExposure = 0.72
        }}
      >
        <Suspense fallback={null}>
          <Scene settings={settings} onInteract={onInteract} />
          <LoadGate onReady={markSceneReady} />
        </Suspense>
        {pointerLockEnabled && (
          <PointerLockControls
            ref={controls as never}
            pointerSpeed={settings.sensitivity}
            onUnlock={() => {
              // Esc during play means "pause", not "silently lose control".
              if (useHud.getState().screen === 'playing') setScreen('paused')
            }}
          />
        )}
      </Canvas>

      {(screen === 'playing' || screen === 'paused') && <Hud />}
      {screen === 'loading' && <LoadingScreen progress={progress} />}
      {screen === 'title' && <TitleScreen onStart={enterWorld} />}
      {screen === 'paused' && (
        <PauseMenu settings={settings} onChange={setSettings} onResume={enterWorld} />
      )}
      {screen === 'dialogue' && (
        <Dialogue key={openCharacterId} characterId={openCharacterId} onClose={enterWorld} />
      )}
      {screen === 'office' && openAgentId && (
        <OfficePanel agentId={openAgentId} onClose={enterWorld} />
      )}
    </>
  )
}
