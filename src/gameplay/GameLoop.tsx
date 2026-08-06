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
import { PerspectiveCamera, Vector3 } from 'three'
import { advanceRuntimeTime, rt, setRuntimePaused } from './runtime'
import { boomDistance, smoothBoom } from './camera-boom'
import { useKeys } from './input'
import { EYE_HEIGHT } from './collision'
import { useHud, inputLocked } from '../ui/hud-store'
import { cityAudio } from '../audio'
import { debugInspectionView } from './dev-view'
import { visionCaptureSpec } from './vision-capture'
import { manhattanCollision } from '../world/manhattan-collision'
import { cityWorld } from '../city/registry.js'
import { vehicleSim, stepVehicleSession } from './vehicles/vehicle-session'
import { manhattanVehicleWorld } from '../world/manhattan-vehicle-world'
import { speedKmh } from './vehicles/vehicle-model'
import { NO_VEHICLE_INPUT, type PlayerVehicleInput } from './vehicles/vehicle-control'

const WALK_SPEED = 4.3
const SPRINT_SPEED = 7.1
const JUMP_VELOCITY = 6.2
const FLY_SPEED = 18
const FLY_SPRINT_SPEED = 42
const GRAVITY = -22
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
  const boom = useRef(0)
  const softFloorUntil = useRef(0)
  const forwardVec = useRef(new Vector3())
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
            useHud
              .getState()
              .set(
                'promptLabel',
                rt.player.flying
                  ? '✈ FLY MODE — Space↑ Ctrl↓ Shift=Fast — Double-Space to land'
                  : '🚶 WALK MODE — Double-Space to fly',
              )
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
    const dt = Math.min(rawDt, MAX_DT)
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

      // ── Ground height under the player ──────────────────────────────────
      const ground = manhattanCollision.groundHeightAt(p.pos.x, p.pos.z)
      // The street tiles stream toward the camera; at spawn the surface may
      // not have arrived yet. Hold the player on the data land level for a
      // short grace after the base registers — long enough for the tiles to
      // stream in, short enough that walking off the island into the harbor
      // still falls instead of walking on an invisible floor.
      const dataLand = (cityWorld.city?.meta?.land_level_m as number | undefined) ?? 12
      let effectiveGround: number | null = ground
      if (ground === null && p.pos.y > dataLand - 0.5) {
        if (softFloorUntil.current === 0 && manhattanCollision.baseReady) {
          softFloorUntil.current = performance.now() + 15000
        }
        if (performance.now() < softFloorUntil.current) effectiveGround = dataLand
      } else if (ground !== null) {
        softFloorUntil.current = 0
      }

      // ── Input → motion ──────────────────────────────────────────────────
      let dx = 0
      let dz = 0
      const k = keys.current
      const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0)
      const strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0)

      if (fwd !== 0 || strafe !== 0) {
        camera.getWorldDirection(forwardVec.current)
        const f = forwardVec.current
        // Looking straight up or down leaves a near-zero horizontal
        // projection; normalising that would turn float noise into a
        // movement direction, so move nothing instead.
        const flatLen = Math.hypot(f.x, f.z)
        if (flatLen < 1e-4) {
          dx = 0
          dz = 0
        } else {
          f.y = 0
          f.normalize()
          const rx = -f.z
          const rz = f.x
          let mx = f.x * fwd + rx * strafe
          let mz = f.z * fwd + rz * strafe
          const len = Math.hypot(mx, mz) || 1
          mx /= len
          mz /= len

          const speed =
            (p.flying ? (k.sprint ? FLY_SPRINT_SPEED : FLY_SPEED) : k.sprint ? SPRINT_SPEED : WALK_SPEED) *
            rt.devSpeed
          dx = mx * speed * dt
          dz = mz * speed * dt
        }
      }

      if (p.flying) {
        const flySpeed = (k.sprint ? FLY_SPRINT_SPEED : FLY_SPEED) * rt.devSpeed
        let dy = 0
        if (k.jump) dy += flySpeed * dt
        if (k.crouch) dy -= flySpeed * dt
        const moved = manhattanCollision.move(p.pos, dx, dz)
        p.pos.x = moved.x
        p.pos.z = moved.z
        // Descending onto a tower lands on the roof rather than dropping
        // through it into the building.
        if (dy < 0) {
          const roof = manhattanCollision.buildingTopAt(p.pos.x, p.pos.z)
          if (roof !== null && p.pos.y + dy <= roof + 1) {
            p.pos.y = roof + 1
            dy = 0
            p.grounded = true
          }
        }
        p.pos.y += dy
        p.velocityY = 0
        p.grounded = p.grounded || (dy === 0 && p.pos.y <= (ground ?? 0) + 1)
        if (ground !== null && p.pos.y < ground + 0.1) {
          p.pos.y = ground + 0.1
          p.grounded = true
        }
      } else {
        if (k.jump && p.grounded) {
          p.velocityY = JUMP_VELOCITY
          p.grounded = false
        }
        // Horizontal move, sliding along building walls.
        const moved = manhattanCollision.move(p.pos, dx, dz)
        p.pos.x = moved.x
        p.pos.z = moved.z

        // Vertical integration against the island surface.
        let vy = p.velocityY + GRAVITY * dt
        let ny = p.pos.y + vy * dt
        if (effectiveGround !== null) {
          if (ny <= effectiveGround) {
            ny = effectiveGround
            vy = 0
            p.grounded = true
          } else {
            p.grounded = false
          }
        } else if (ny < -200) {
          // Fell off the island edge — pull back to the last surface.
          ny = 12.4
          vy = 0
          p.grounded = true
        }
        p.pos.y = ny
        p.velocityY = vy
      }
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
        camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z)
        if (rt.thirdPerson) {
          camera.getWorldDirection(forwardVec.current)
          const eye = { x: p.pos.x, y: p.pos.y + EYE_HEIGHT, z: p.pos.z }
          const wanted = boomDistance(eye, forwardVec.current, [])
          boom.current = smoothBoom(boom.current, wanted, dt)
          camera.position.addScaledVector(forwardVec.current, -boom.current)
        } else if (boom.current !== 0) {
          boom.current = 0
        }
      }
    }

    if (!driving) {
      p.forward.x = forwardVec.current.x
      p.forward.z = forwardVec.current.z
      const flen = Math.hypot(p.forward.x, p.forward.z) || 1
      p.forward.x /= flen
      p.forward.z /= flen
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
