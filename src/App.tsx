/**
 * Assembly: canvas, scene graph, overlays, and the screen state machine that
 * decides who owns the mouse.
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PointerLockControls, useProgress } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing'
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
import { ENTRANCE, HQ, OFFICE_SLOTS, PANEL, SECRETARY as SEC_POS } from './world/layout'
import { PALETTE, QUALITY } from './world/palette'
import { Hud } from './ui/Hud'
import { Dialogue } from './ui/Dialogue'
import { OfficePanel } from './ui/OfficePanel'
import { DEFAULT_SETTINGS, LoadingScreen, PauseMenu, TitleScreen, type Settings } from './ui/Screens'

/** Hands the renderer to the perf overlay and applies quality settings. */
function RendererBridge({ maxDpr, shadows }: { maxDpr: number; shadows: boolean }) {
  const gl = useThree((s) => s.gl)
  const setDpr = useThree((s) => s.setDpr)

  useEffect(() => {
    ;(window as { __gameRenderer?: THREE.WebGLRenderer }).__gameRenderer = gl
    gl.shadowMap.enabled = shadows
    gl.shadowMap.type = THREE.PCFSoftShadowMap
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
      {/* Night sky above, city bounce below. Never let anything go to zero. */}
      <hemisphereLight args={[PALETTE.horizon, '#0d1420', 1.15]} />
      <ambientLight intensity={0.42} color={PALETTE.coolLight} />

      {/* Moon key, casting the plaza's long shadows */}
      <directionalLight
        position={[38, 60, 34]}
        intensity={1.5}
        color="#c3d6f5"
        castShadow={shadows}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-near={1}
        shadow-camera-far={190}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-bias={-0.0006}
      />

      {/* Cool fill from the opposite side so shadowed faces keep their form */}
      <directionalLight position={[-30, 26, 28]} intensity={0.5} color="#7f9dd0" />

      {/* Warm spill from the lobby, out through the glass onto the plaza —
          this is what makes the entrance read as somewhere worth walking in. */}
      <pointLight
        position={[0, 4.2, -4]}
        color={PALETTE.warmLight}
        intensity={900}
        distance={46}
        decay={2}
      />
      <pointLight
        position={[0, 3.4, 7]}
        color={PALETTE.warmLight}
        intensity={280}
        distance={26}
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
  const link = useGame((s) => s.link)
  const quality = QUALITY[settings.quality]
  const agents = snapshot?.agents ?? []

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
        y: 1.25,
        z: PANEL.z,
        label: 'Use the elevator',
        range: 2.4,
        payload: 'car',
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
      {/* Fog starts well beyond the lobby's 30 m depth — at 40 m it was
          washing the interior the moment you stepped inside. */}
      <fog attach="fog" args={[PALETTE.horizon, 95, 420]} />

      <RendererBridge maxDpr={quality.maxDpr} shadows={quality.shadows} />
      <Lighting shadows={quality.shadows} shadowMapSize={quality.shadowMapSize} />

      <Exterior quality={quality} />
      <Lobby quality={quality} />
      <Elevator />
      <Floor45 agents={agents} quality={quality} source={snapshot?.source ?? 'demo'} />
      <Secretary link={link} />

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

      <GameLoop interactables={interactables} onInteract={onInteract} />

      {quality.postprocessing && (
        <EffectComposer>
          <Bloom intensity={0.62} luminanceThreshold={0.62} luminanceSmoothing={0.28} mipmapBlur />
          <Vignette offset={0.28} darkness={0.72} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  )
}

/**
 * Decides when the world is ready to enter.
 *
 * `useProgress` only knows about things routed through THREE's loading
 * manager. This scene is entirely procedural — the geometry is code, not
 * assets — so progress can legitimately sit at 0 with nothing ever loading,
 * and gating on `progress >= 100` alone hangs on the loading card forever.
 *
 * So: ready when real loading finishes, OR when a short settle passes with
 * nothing in flight. The timeout is the normal path today and the safety net
 * once GLB assets arrive.
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
    if (active) return
    const id = setTimeout(fire, 700)
    return () => clearTimeout(id)
  }, [active, progress, fire])

  return null
}

export default function App() {
  const screen = useHud((s) => s.screen)
  const setScreen = useHud((s) => s.setScreen)
  const openAgentId = useHud((s) => s.openAgentId)
  const start = useGame((s) => s.start)
  const dispose = useGame((s) => s.dispose)

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const controls = useRef<{ lock(): void; unlock(): void } | null>(null)

  useEffect(() => {
    start()
    return () => dispose()
  }, [start, dispose])


  // Fake a little progress so the loading card is not a frozen empty bar on a
  // fast machine; the real gate is LoadGate.
  useEffect(() => {
    if (ready) return
    const id = setInterval(() => setProgress((p) => Math.min(0.92, p + 0.08)), 90)
    return () => clearInterval(id)
  }, [ready])

  useEffect(() => {
    if (ready && screen === 'loading') setScreen('title')
  }, [ready, screen, setScreen])

  const enterWorld = useCallback(() => {
    setScreen('playing')
    // The browser only grants pointer lock from a user gesture; this call is
    // still inside the click handler's task, so it is allowed.
    controls.current?.lock()
  }, [setScreen])

  const onInteract = useCallback(
    (target: Interactable) => {
      switch (target.kind) {
        case 'secretary':
          controls.current?.unlock()
          setScreen('dialogue')
          break
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
          setScreen('office')
          break
      }
    },
    [setScreen],
  )

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: settings.fov, near: 0.1, far: 900, position: [0, 1.7, 36] }}
        // See lib/resize.ts — without this the canvas never gets measured on
        // hosts whose ResizeObserver never fires, and the game hangs on the
        // loading screen with no error.
        resize={{ polyfill: ResilientResizeObserver as unknown as typeof ResizeObserver }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.25
        }}
      >
        <Suspense fallback={null}>
          <Scene settings={settings} onInteract={onInteract} />
          <LoadGate onReady={() => setReady(true)} />
        </Suspense>
        <PointerLockControls
          ref={controls as never}
          pointerSpeed={settings.sensitivity}
          onUnlock={() => {
            // Esc during play means "pause", not "silently lose control".
            if (useHud.getState().screen === 'playing') setScreen('paused')
          }}
        />
      </Canvas>

      {screen === 'playing' && <Hud />}
      {screen === 'loading' && <LoadingScreen progress={progress} />}
      {screen === 'title' && <TitleScreen onStart={enterWorld} />}
      {screen === 'paused' && (
        <PauseMenu settings={settings} onChange={setSettings} onResume={enterWorld} />
      )}
      {screen === 'dialogue' && <Dialogue />}
      {screen === 'office' && openAgentId && <OfficePanel agentId={openAgentId} />}
    </>
  )
}
