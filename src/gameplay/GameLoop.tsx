/**
 * The one place the simulation advances.
 *
 * Every mutable thing — elevator, doors, player, camera, the car's transform —
 * is updated here, in a fixed order, once per frame. Scattering this across
 * component-level useFrame calls would make the ordering depend on React's
 * render order, and the first symptom would be the player sinking through the
 * lift floor on the frame the car moved first.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { rt } from './runtime'
import { useKeys } from './input'
import { EYE_HEIGHT, moveWithCollisions, type AABB } from './collision'
import { carHeight, currentFloor, doorOpenness, step, FLOORS } from './elevator'
import { leafOffset, stepDoor } from './doors'
import { shaftGuards } from './shaft'
import { pickTarget, placeMovingTargets, type Interactable } from './interact'
import { hudMirrorChanged } from './hud-mirror'
import { cityTourLocationEvents } from './city-tour'
import {
  ENTRANCE,
  SHAFT,
  carColliders,
  hqColliders,
  slidingDoorColliders,
  staticColliders,
} from '../world/layout'
import { useHud, inputLocked } from '../ui/hud-store'

const WALK_SPEED = 4.3
const SPRINT_SPEED = 7.1
const JUMP_VELOCITY = 6.2

/** Longest frame the simulation will integrate. Beyond this we slow down time
 *  rather than let one stalled frame teleport the player through the world. */
const MAX_DT = 1 / 20

const HUD_INTERVAL = 0.1

const CAR_DOOR_HEIGHT = SHAFT.carHeight - 0.2

export interface GameLoopProps {
  interactables: Interactable[]
  onInteract(target: Interactable): void
}

export function GameLoop({ interactables, onInteract }: GameLoopProps) {
  const { camera } = useThree()
  const keys = useKeys()
  const hudTimer = useRef(0)
  const prevCarY = useRef(carHeight(rt.elevator))
  const forwardVec = useRef(new Vector3())

  // Static geometry never changes; rebuilding it per frame would dominate the
  // frame budget for no reason.
  const staticWorld = useMemo<AABB[]>(() => [...staticColliders(), ...hqColliders()], [])

  useEffect(() => {
    rt.interactables = interactables
  }, [interactables])

  // ── Interact key ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault()
        useHud.getState().togglePerf()
        return
      }
      if (e.code !== 'KeyE') return
      if (inputLocked(useHud.getState().screen)) return
      const target = rt.target
      if (target) onInteract(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onInteract])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, MAX_DT)
    const p = rt.player
    const locked = inputLocked(useHud.getState().screen)

    // ── 1. Entrance doors ────────────────────────────────────────────────────
    rt.entranceDoor = stepDoor(rt.entranceDoor, {
      dx: p.pos.x,
      dz: p.pos.z - ENTRANCE.z,
      dt,
    })

    // ── 2. Elevator, with the obstruction check before the tick ─────────────
    const carYBefore = carHeight(rt.elevator)
    const inDoorway =
      Math.abs(p.pos.x) < SHAFT.halfWidth + 0.35 &&
      Math.abs(p.pos.z - SHAFT.doorZ) < 1.15 &&
      Math.abs(p.pos.y - carYBefore) < 2.2

    if (inDoorway) rt.elevator = step(rt.elevator, { type: 'OBSTRUCT' })
    rt.elevator = step(rt.elevator, { type: 'TICK', dt })

    const carY = carHeight(rt.elevator)
    const carOpen = doorOpenness(rt.elevator)

    // ── 3. Dynamic collision ─────────────────────────────────────────────────
    const colliders: AABB[] = [
      ...staticWorld,
      ...carColliders(carY),
      ...shaftGuards(carY, carOpen),
      ...slidingDoorColliders(
        0,
        0,
        ENTRANCE.z,
        ENTRANCE.halfWidth,
        ENTRANCE.height,
        rt.entranceDoor.openness,
      ),
      ...slidingDoorColliders(0, carY, SHAFT.doorZ, SHAFT.halfWidth, CAR_DOOR_HEIGHT, carOpen),
    ]

    // ── 4. Input → desired horizontal motion, in camera space ────────────────
    let dx = 0
    let dz = 0
    if (!locked) {
      const k = keys.current
      const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0)
      const strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0)

      if (fwd !== 0 || strafe !== 0) {
        camera.getWorldDirection(forwardVec.current)
        const f = forwardVec.current
        f.y = 0
        f.normalize()
        // Right-hand vector on the ground plane.
        const rx = -f.z
        const rz = f.x

        let mx = f.x * fwd + rx * strafe
        let mz = f.z * fwd + rz * strafe
        const len = Math.hypot(mx, mz) || 1
        mx /= len
        mz /= len

        const speed = k.sprint ? SPRINT_SPEED : WALK_SPEED
        dx = mx * speed * dt
        dz = mz * speed * dt
      }

      if (k.jump && p.grounded) {
        p.velocityY = JUMP_VELOCITY
        p.grounded = false
      }
    }

    // ── 5. Move ──────────────────────────────────────────────────────────────
    const result = moveWithCollisions(p.pos, { x: dx, z: dz }, p.velocityY, dt, colliders)
    p.pos = result.position
    p.velocityY = result.velocityY
    p.grounded = result.grounded

    // Location objectives are pure and idempotent. Once a step advances,
    // repeated frames in the same zone return the exact same tour object.
    const hud = useHud.getState()
    for (const event of cityTourLocationEvents(p.pos)) hud.advanceCityTour(event)

    // ── 6. Carry the player with the car ─────────────────────────────────────
    // Explicit rather than relying on the floor collider to push: at 25 m/s the
    // car rises further per frame than the step height, so support alone would
    // drop the player through the floor.
    const insideCar =
      Math.abs(p.pos.x) < SHAFT.halfWidth &&
      p.pos.z < SHAFT.doorZ &&
      p.pos.z > SHAFT.doorZ - SHAFT.carDepth &&
      p.pos.y >= carYBefore - 0.6 &&
      p.pos.y < carYBefore + SHAFT.carHeight

    if (insideCar) {
      const lift = carY - prevCarY.current
      if (lift !== 0) {
        p.pos.y += lift
        // Cancel accumulated fall speed, or the player "lands" hard on arrival.
        if (lift > 0) p.velocityY = 0
      }
    }
    prevCarY.current = carY

    // ── 7. Camera follows the body ───────────────────────────────────────────
    camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z)

    // ── 8. Interaction targeting ─────────────────────────────────────────────
    camera.getWorldDirection(forwardVec.current)
    const fx = forwardVec.current.x
    const fz = forwardVec.current.z
    const flen = Math.hypot(fx, fz) || 1
    p.forward.x = fx / flen
    p.forward.z = fz / flen

    placeMovingTargets(rt.interactables, carY)
    rt.target = locked
      ? null
      : pickTarget(rt.interactables, {
          px: p.pos.x,
          py: p.pos.y + EYE_HEIGHT,
          pz: p.pos.z,
          fx: p.forward.x,
          fz: p.forward.z,
        })

    // ── 9. Drive the meshes the simulation owns ──────────────────────────────
    const refs = rt.refs
    if (refs.car) refs.car.position.y = carY

    // leafOffset is the shared source of truth with slidingDoorColliders, so
    // what you see and what blocks you cannot disagree.
    const carLeaf = leafOffset(SHAFT.halfWidth, carOpen)
    if (refs.carDoorLeft) refs.carDoorLeft.position.x = -carLeaf
    if (refs.carDoorRight) refs.carDoorRight.position.x = carLeaf

    const entLeaf = leafOffset(ENTRANCE.halfWidth, rt.entranceDoor.openness)
    if (refs.entranceLeft) refs.entranceLeft.position.x = -entLeaf
    if (refs.entranceRight) refs.entranceRight.position.x = entLeaf

    // ── 10. Perf sampling + throttled HUD mirror ─────────────────────────────
    const perf = rt.perf
    perf.frames += 1
    perf.accum += rawDt
    if (perf.accum >= 0.5) {
      perf.fps = perf.frames / perf.accum
      perf.frameMs = (perf.accum / perf.frames) * 1000
      perf.frames = 0
      perf.accum = 0

      // Read the renderer that is actually drawing this frame.
      const info = state.gl.info
      perf.calls = info.render.calls
      perf.triangles = info.render.triangles
      perf.geometries = info.memory.geometries
      perf.programs = info.programs?.length ?? 0
    }

    hudTimer.current += dt
    if (hudTimer.current >= HUD_INTERVAL) {
      hudTimer.current = 0
      const hud = useHud.getState()
      const floor = currentFloor(rt.elevator)
      const label = floor
        ? FLOORS[floor].label
        : rt.elevator.phase === 'travelling'
          ? '··'
          : hud.floorLabel

      const next = {
        promptLabel: rt.target?.label ?? null,
        promptKind: rt.target?.kind ?? null,
        promptPayload: rt.target?.payload ?? null,
        floorLabel: label,
        elevatorPhase: rt.elevator.phase,
        fps: Math.round(perf.fps),
        frameMs: Math.round(perf.frameMs * 10) / 10,
      }

      // Only write when something actually changed — zustand notifies on every
      // set, and at 10 Hz an unconditional write re-renders the HUD forever.
      if (hudMirrorChanged(next, hud)) {
        useHud.setState(next)
      }
    }
  })

  return null
}
