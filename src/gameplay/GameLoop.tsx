/**
 * The one place the simulation advances — Manhattan edition.
 *
 * A much smaller loop than the original headquarters build: walk/sprint/jump,
 * fly mode, ground-height tracking against the island surface, building
 * collision through the per-tile BVHs, first/third person camera, footsteps
 * and the perf overlay. No elevator, no car, no scripted NPCs.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { advanceRuntimeTime, rt, setRuntimePaused } from './runtime'
import { useKeys } from './input'
import { useHud, inputLocked } from '../ui/hud-store'
import { cityAudio } from '../audio'
import { debugInspectionView } from './dev-view'
import { visionCaptureSpec } from './vision-capture'
import { vehicleSim, stepVehicleSession } from './vehicles/vehicle-session'
import { manhattanVehicleWorld } from '../world/manhattan-vehicle-world'
import { speedKmh } from './vehicles/vehicle-model'
import { NO_VEHICLE_INPUT, type PlayerVehicleInput } from './vehicles/vehicle-control'
import { OnFootController } from './player/walk-step'
import { WalkCamera } from './player/walk-camera'
import { look, setLook } from './player/look-state'
import { playerMotion, resetPlayerMotion } from './player/player-motion'
import { yawFromForward } from './player/orbit-camera'
import { publishView } from './player/view-state'
import { stepDt } from './player/sim-step'

const MAX_DT = 1 / 20
const HUD_INTERVAL = 0.1

export interface GameLoopProps {
  interactables?: unknown[]
  ambientPedestrians?: number
}

export function GameLoop() {
  const { camera } = useThree()
  const keys = useKeys()
  const hudTimer = useRef(0)
  // On-foot movement and the orbit camera live in ./player; GameLoop only
  // decides when they run, so the driving branch and these never collide.
  const onFoot = useRef(new OnFootController())
  const walkCamera = useRef(new WalkCamera())
  const wasDriving = useRef(false)
  const lastSpacePress = useRef(0)
  const lastJump = useRef(false)
  const lastInteract = useRef(false)
  const transientPrompt = useRef<{ label: string; until: number } | null>(null)

  const vision = useMemo(
    () => visionCaptureSpec(typeof location === 'undefined' ? '' : location.search),
    [],
  )

  // Dev inspection camera: ?spawn=<viewpoint> in dev builds parks the camera
  // at a named Manhattan viewpoint instead of following the player.
  const inspection = useMemo(
    () =>
      !vision && import.meta.env.DEV && typeof location !== 'undefined'
        ? debugInspectionView(location.search, true)
        : null,
    [vision],
  )

  useEffect(() => {
    if (typeof location === 'undefined') return
    const spec = visionCaptureSpec(location.search)
    if (spec) {
      camera.position.set(spec.position.x, spec.position.y, spec.position.z)
      camera.lookAt(spec.target.x, spec.target.y, spec.target.z)
      ;(camera as unknown as PerspectiveCamera).fov = spec.fov
      ;(camera as unknown as PerspectiveCamera).updateProjectionMatrix()
      return
    }
  }, [camera, vision])

  // ── Keyboard shortcuts: V third person, F3 perf, double-Space fly ──────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV') {
        e.preventDefault()
        if (!inputLocked(useHud.getState().screen)) useHud.getState().toggleThirdPerson()
        return
      }
      if (e.code === 'F3') {
        e.preventDefault()
        useHud.getState().togglePerf()
        return
      }
      if (e.code === 'Space') {
        if (!inputLocked(useHud.getState().screen)) {
          // Space is the horn while driving; the fly toggle is for feet.
          if (vehicleSim.registry.playerVehicleId !== null) return
          const now = performance.now()
          if (now - lastSpacePress.current < 350) {
            rt.player.flying = !rt.player.flying
            rt.player.velocityY = 0
            const label = rt.player.flying
              ? 'Fly mode. Space climbs, Ctrl descends, Shift is fast. Press Space twice to land.'
              : 'Walking. Press Space twice to fly.'
            useHud.getState().set('promptLabel', label)
            transientPrompt.current = { label, until: now + 4000 }
          }
          lastSpacePress.current = now
        }
        return
      }
      if (e.code === 'F2') {
        e.preventDefault()
        if (!inputLocked(useHud.getState().screen)) useHud.getState().toggleDevTools()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useFrame((state, rawDt) => {
    const dt = stepDt(rawDt, MAX_DT)
    const p = rt.player
    const hudNow = useHud.getState()
    const locked = inputLocked(hudNow.screen)
    rt.thirdPerson = hudNow.thirdPerson

    Object.assign(rt.keys, keys.current)
    setRuntimePaused(locked)
    if (locked) {
      Object.assign(keys.current, rt.keys)
      return
    }

    const simulationTime = advanceRuntimeTime(dt)
    void simulationTime

    // ── Cinematic intro: advance the clock, freeze the player, let
    //    IntroCamera own the camera until the handover. ─────────────────────
    if (rt.introSeconds < 4.6) {
      rt.introSeconds += dt
      return
    }

    const driving = vehicleSim.registry.playerVehicleId !== null
    if (wasDriving.current && !driving) {
      // Out of the car: body and orbit camera pick up the car's heading
      // instead of snapping back to wherever the mouse left them.
      setLook(yawFromForward(p.forward.x, p.forward.z), -0.12)
      resetPlayerMotion(p.forward.x, p.forward.z)
      walkCamera.current.reset()
    }
    wasDriving.current = driving

    // ── Vehicle session ────────────────────────────────────────────────────
    // The vehicle world steps every frame — AI traffic circulates and
    // pedestrians cross even while the player is on foot. Player input is
    // fed only while driving; the walk branch below copies the player's
    // feet into the sim so prompts track the walker.
    const k = keys.current
    const simInput: PlayerVehicleInput = driving
      ? {
          throttle: k.forward ? 1 : 0,
          brake: k.back ? 1 : 0,
          steer: (k.right ? 1 : 0) - (k.left ? 1 : 0),
          handbrake: k.sprint,
          horn: k.jump && !lastJump.current,
          interact: k.interact && !lastInteract.current,
        }
      : NO_VEHICLE_INPUT
    lastJump.current = k.jump
    lastInteract.current = k.interact
    vehicleSim.cameraMode = rt.thirdPerson ? 'chase' : 'cockpit'

    const events =
      !vision && !inspection
        ? stepVehicleSession(manhattanVehicleWorld, simInput, dt, rt.clock.hour)
        : []

    // Mirror the authoritative simulation pose back onto the runtime so the
    // save, the audio listener and the HUD all read one position.
    if (driving) {
      const sp = vehicleSim.player
      p.pos.x = sp.pos.x
      p.pos.y = sp.pos.y
      p.pos.z = sp.pos.z
      p.velocityY = sp.velocityY
      p.grounded = sp.grounded
      p.forward.x = sp.forward.x
      p.forward.z = sp.forward.z
    }

    for (const event of events) {
      const vehicle = 'vehicleId' in event
        ? vehicleSim.registry.vehicles.get(event.vehicleId)
        : null
      const at = vehicle
        ? { x: vehicle.pose.pos.x, y: vehicle.pose.pos.y + 1, z: vehicle.pose.pos.z }
        : { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }
      switch (event.type) {
        case 'prompt':
          useHud.getState().set('promptLabel', event.label)
          break
        case 'horn':
          cityAudio.play('horn', at)
          break
        case 'enter':
          cityAudio.play('doorClose', at)
          break
        case 'exit':
          cityAudio.play('doorOpen', at)
          break
        case 'exit-blocked':
          useHud.getState().set('promptLabel', 'No room to exit here')
          transientPrompt.current = {
            label: 'No room to exit here',
            until: performance.now() + 2500,
          }
          break
          default:
            break
        }
      }

    if (!driving) {
      // The sim needs the walker's feet for prompts while the player walks.
      vehicleSim.player.pos.x = p.pos.x
      vehicleSim.player.pos.y = p.pos.y
      vehicleSim.player.pos.z = p.pos.z
      onFoot.current.step(keys.current, dt, rt.clock.elapsed)
    }

    // ── Footsteps ─────────────────────────────────────────────────────────
    if (!driving) cityAudio.update(p, dt)

    // ── Camera ────────────────────────────────────────────────────────────
    if (!vision && !inspection) {
      if (driving) {
        // The vehicle camera (chase/cockpit) is computed by the simulation
        // with its own collision sweep; the pointer-lock camera stands down.
        camera.position.set(vehicleSim.camera.pos.x, vehicleSim.camera.pos.y, vehicleSim.camera.pos.z)
        camera.lookAt(vehicleSim.camera.target.x, vehicleSim.camera.target.y, vehicleSim.camera.target.z)
      } else {
        walkCamera.current.update(camera as PerspectiveCamera, dt, performance.now())
      }
    }

    if (!driving) {
      // Camera heading, flat: the audio listener, dev spawns and the save
      // read this. The body's own facing is playerMotion.foot.bodyYaw.
      p.forward.x = -Math.sin(look.yaw)
      p.forward.z = -Math.cos(look.yaw)
    }

    {
      const playerVehicle = driving
        ? vehicleSim.registry.vehicles.get(vehicleSim.registry.playerVehicleId!)
        : null
      const speed = playerVehicle ? Math.abs(playerVehicle.motion.speed) : playerMotion.groundSpeed
      publishView(camera, p.pos.x, p.pos.z, speed, driving)
    }

    // A transient prompt (e.g. "No room to exit") clears on its own.
    if (
      transientPrompt.current &&
      performance.now() > transientPrompt.current.until &&
      useHud.getState().promptLabel === transientPrompt.current.label
    ) {
      transientPrompt.current = null
      useHud.getState().set('promptLabel', null)
    }

    // ── Perf sampling + throttled HUD mirror ──────────────────────────────
    const perf = rt.perf
    const rendererInfo = state.gl.info
    if (rendererInfo.autoReset) {
      rendererInfo.autoReset = false
    }
    const frameCalls = rendererInfo.render.calls
    const frameTriangles = rendererInfo.render.triangles
    rendererInfo.reset()
    perf.frames += 1
    perf.accum += rawDt
    perf.frameTimes.push(rawDt * 1000)
    if (perf.frameTimes.length > 600) perf.frameTimes.splice(0, perf.frameTimes.length - 600)
    if (perf.accum >= 0.5) {
      perf.fps = perf.frames / perf.accum
      perf.frameMs = (perf.accum / perf.frames) * 1000
      const sortedFrameTimes = [...perf.frameTimes].sort((left, right) => left - right)
      const percentile99 =
        sortedFrameTimes[Math.min(sortedFrameTimes.length - 1, Math.floor(sortedFrameTimes.length * 0.99))] ?? 0
      perf.low1Fps = percentile99 > 0 ? 1000 / percentile99 : 0
      perf.frames = 0
      perf.accum = 0
      perf.calls = frameCalls
      perf.triangles = frameTriangles
      perf.geometries = rendererInfo.memory.geometries
      perf.programs = rendererInfo.programs?.length ?? 0
      perf.textures = rendererInfo.memory.textures
    }

    hudTimer.current += dt
    if (hudTimer.current >= HUD_INTERVAL) {
      hudTimer.current = 0
      const hud = useHud.getState()
      const documentRoot = document.documentElement
      documentRoot.dataset.perfFps = perf.fps.toFixed(2)
      documentRoot.dataset.perfLow1Fps = perf.low1Fps.toFixed(2)
      documentRoot.dataset.perfDrawCalls = String(perf.calls)
      documentRoot.dataset.perfTriangles = String(perf.triangles)
      documentRoot.dataset.perfGeometries = String(perf.geometries)
      documentRoot.dataset.perfTextures = String(perf.textures)
      documentRoot.dataset.perfPrograms = String(perf.programs)
      documentRoot.dataset.runtimePlayerPosition = [
        p.pos.x,
        p.pos.y,
        p.pos.z,
      ]
        .map((value) => value.toFixed(3))
        .join(',')

      const playerVehicle = driving ? vehicleSim.registry.vehicles.get(vehicleSim.registry.playerVehicleId!) : null
      const next = {
        fps: Math.round(perf.fps),
        frameMs: Math.round(perf.frameMs * 10) / 10,
        mapPlayerX: Math.round(p.pos.x * 4) / 4,
        mapPlayerZ: Math.round(p.pos.z * 4) / 4,
        mapHeading: Math.round((Math.atan2(p.forward.x, p.forward.z) * 180) / Math.PI),
        vehicleSpeedKmh: playerVehicle ? Math.round(speedKmh(playerVehicle.motion.speed)) : 0,
      }
      const changed =
        next.fps !== hud.fps ||
        next.frameMs !== hud.frameMs ||
        next.mapPlayerX !== hud.mapPlayerX ||
        next.mapPlayerZ !== hud.mapPlayerZ ||
        next.mapHeading !== hud.mapHeading ||
        next.vehicleSpeedKmh !== hud.vehicleSpeedKmh
      if (changed) {
        useHud.setState(next)
      }
    }
  }, -100)

  return null
}
