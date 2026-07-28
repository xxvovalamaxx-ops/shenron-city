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
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import { rt } from './runtime'
import { advanceTraffic, vehicleColliders, vehiclePose } from './traffic'
import { boomDistance, smoothBoom } from './camera-boom'
import { VEHICLE } from '../world/city-data'
import { useKeys } from './input'
import { EYE_HEIGHT, moveWithCollisions, type AABB } from './collision'
import { npcColliders } from '../agents/ambient-routes'
import { carHeight, currentFloor, doorOpenness, step, FLOORS } from './elevator'
import { leafOffset, stepDoor } from './doors'
import { shaftGuards } from './shaft'
import { pickTarget, placeMovingTargets, type Interactable } from './interact'
import { hudMirrorChanged } from './hud-mirror'
import { cityTourLocationEvents } from './city-tour'
import { cityTourTarget, cityTourWayfinding } from './wayfinding'
import { minimapHeading } from './minimap'
import {
  ENTRANCE,
  SHAFT,
  carColliders,
  hqColliders,
  slidingDoorColliders,
  staticColliders,
} from '../world/layout'
import { useHud, inputLocked } from '../ui/hud-store'
import { AUDIO_ANCHORS, cityAudio } from '../audio'
import { useLaser } from '../weapons/useLaser'
import { capybaraCollider, capybaraPose } from '../animals/capybara'
import { residentColliders } from './residents'
import { breakableColliders } from '../destruction/collision'
import { debugInspectionView } from './dev-view'

const WALK_SPEED = 4.3
const SPRINT_SPEED = 7.1
const JUMP_VELOCITY = 6.2

/** Longest frame the simulation will integrate. Beyond this we slow down time
 *  rather than let one stalled frame teleport the player through the world. */
const MAX_DT = 1 / 20

const HUD_INTERVAL = 0.1

const CAR_DOOR_HEIGHT = SHAFT.carHeight - 0.2

/** Openness above which a door counts as "moving", for audio edge detection. */
const DOOR_EVENT_EPS = 0.02

export interface GameLoopProps {
  interactables: Interactable[]
  /** Same quality-scaled count rendered by AmbientCrowd. */
  ambientPedestrians: number
  onInteract(target: Interactable): void
}

export function GameLoop({ interactables, ambientPedestrians, onInteract }: GameLoopProps) {
  const { camera } = useThree()
  const keys = useKeys()
  const hudTimer = useRef(0)
  const prevCarY = useRef(carHeight(rt.elevator))
  const forwardVec = useRef(new Vector3())

  // Static geometry never changes; rebuilding it per frame would dominate the
  // frame budget for no reason.
  const staticWorld = useMemo<AABB[]>(() => [...staticColliders(), ...hqColliders()], [])
  const stationaryResidents = useMemo<AABB[]>(
    () => residentColliders(interactables),
    [interactables],
  )

  useEffect(() => {
    rt.interactables = interactables
  }, [interactables])

  useEffect(() => {
    if (typeof location === 'undefined') return
    const view = debugInspectionView(location.search, import.meta.env.DEV)
    if (!view) return
    camera.position.set(view.position.x, view.position.y + EYE_HEIGHT, view.position.z)
    camera.lookAt(view.target.x, view.target.y, view.target.z)
  }, [camera])

  // ── Interact key ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyV') {
        e.preventDefault()
        if (!inputLocked(useHud.getState().screen)) rt.thirdPerson = !rt.thirdPerson
        return
      }
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

  // Scratch transforms, reused so the frame loop allocates nothing.
  const scratch = useRef({ node: new Object3D(), matrix: new Matrix4(), spin: new Quaternion() })

  // Last frame's continuous values, so audio can fire on transitions.
  const audioEdges = useRef({ entrance: 0, carDoor: 0, travelling: false })

  /** Current boom length, eased between frames. Zero in first person. */
  const boom = useRef(0)

  // Laser weapon — raycasts against breakable meshes via Raycaster.intersectObjects().
  const { update: updateLaser } = useLaser()

  /**
   * Push vehicle poses into the instance buffers.
   *
   * Body geometry is authored facing +z, which is also sampleLoop's zero
   * heading, so the yaw is the heading with no correction.
   */
  function writeTrafficInstances(): void {
    const { trafficModels, trafficLamps, trafficSpill } = rt.refs
    if (!trafficLamps || !trafficSpill) return

    const node = scratch.current.node
    const cars = rt.vehicles

    for (let i = 0; i < cars.length; i++) {
      const pose = vehiclePose(cars[i])
      const fx = Math.sin(pose.heading)
      const fz = Math.cos(pose.heading)

      const model = trafficModels[i]
      if (model) {
        model.position.set(pose.x, 0.025, pose.z)
        model.rotation.set(0, pose.heading, 0)
        model.updateMatrix()
      }

      node.rotation.set(0, pose.heading, 0)

      // Two lamp bars per car: headlights forward, tail lights aft.
      const nose = VEHICLE.length * 0.48
      node.position.set(pose.x + fx * nose, VEHICLE.height * 0.42, pose.z + fz * nose)
      node.updateMatrix()
      trafficLamps.setMatrixAt(i * 2, node.matrix)

      node.position.set(pose.x - fx * nose, VEHICLE.height * 0.46, pose.z - fz * nose)
      node.updateMatrix()
      trafficLamps.setMatrixAt(i * 2 + 1, node.matrix)

      // Headlight spill, laid flat on the tarmac just ahead of the car.
      // YXZ so the plane is tipped flat first and then yawed about world up.
      const spillAhead = VEHICLE.length * 0.55 + 2.6
      node.rotation.order = 'YXZ'
      node.rotation.set(-Math.PI / 2, pose.heading, 0)
      node.position.set(pose.x + fx * spillAhead, 0.02, pose.z + fz * spillAhead)
      node.updateMatrix()
      trafficSpill.setMatrixAt(i, node.matrix)
      node.rotation.order = 'XYZ'
    }

    trafficLamps.instanceMatrix.needsUpdate = true
    trafficSpill.instanceMatrix.needsUpdate = true
  }

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, MAX_DT)
    const p = rt.player
    const locked = inputLocked(useHud.getState().screen)

    // Sync key state so other components can read it from rt.keys.
    Object.assign(rt.keys, keys.current)

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

    // ── 2b. Audio events, fired on edges rather than on state ────────────────
    // The doors and the lift expose continuous values, so a level test would
    // retrigger every frame the door is ajar. Compare against last frame.
    const audio = audioEdges.current
    const entranceOpen = rt.entranceDoor.openness
    if (entranceOpen > DOOR_EVENT_EPS && audio.entrance <= DOOR_EVENT_EPS) {
      cityAudio.play('doorOpen', AUDIO_ANCHORS.entranceDoor)
    } else if (entranceOpen <= DOOR_EVENT_EPS && audio.entrance > DOOR_EVENT_EPS) {
      cityAudio.play('doorClose', AUDIO_ANCHORS.entranceDoor)
    }
    audio.entrance = entranceOpen

    if (carOpen > DOOR_EVENT_EPS && audio.carDoor <= DOOR_EVENT_EPS) {
      cityAudio.play('doorOpen', AUDIO_ANCHORS.elevatorDoor(carY))
    } else if (carOpen <= DOOR_EVENT_EPS && audio.carDoor > DOOR_EVENT_EPS) {
      cityAudio.play('doorClose', AUDIO_ANCHORS.elevatorDoor(carY))
    }
    audio.carDoor = carOpen

    const travelling = rt.elevator.phase === 'travelling'
    if (travelling) {
      // Re-issued while moving so the motor source tracks the rising car; the
      // engine treats a repeat as a move, not as a restart.
      cityAudio.play('elevatorStart', AUDIO_ANCHORS.elevatorDoor(carY))
    } else if (audio.travelling) {
      cityAudio.play('elevatorStop', AUDIO_ANCHORS.elevatorDoor(carY))
      cityAudio.play('elevatorArrive', AUDIO_ANCHORS.elevatorDoor(carY))
    }
    audio.travelling = travelling

    // ── 3. Traffic, before collision so the boxes match the visible cars ─────
    advanceTraffic(rt.vehicles, dt, p.pos)
    writeTrafficInstances()

    // Sample once so the visible animal and its moving collision box share the
    // exact same route state.
    rt.capybara = capybaraPose(state.clock.elapsedTime)

    // ── 4. Dynamic collision ─────────────────────────────────────────────────
    const colliders: AABB[] = [
      ...staticWorld,
      ...stationaryResidents,
      ...breakableColliders(rt.destroyed),
      ...vehicleColliders(rt.vehicles),
      ...npcColliders(state.clock.elapsedTime, ambientPedestrians),
      capybaraCollider(rt.capybara),
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

    // ── 5. Input → desired horizontal motion, in camera space ────────────────
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

    // ── 6. Move ──────────────────────────────────────────────────────────────
    const result = moveWithCollisions(p.pos, { x: dx, z: dz }, p.velocityY, dt, colliders)
    p.pos = result.position
    p.velocityY = result.velocityY
    p.grounded = result.grounded

    // Location objectives are pure and idempotent. Once a step advances,
    // repeated frames in the same zone return the exact same tour object.
    const hud = useHud.getState()
    for (const event of cityTourLocationEvents(p.pos)) hud.advanceCityTour(event)

    // ── 7. Carry the player with the car ─────────────────────────────────────
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

    // ── 8. Camera follows the body ───────────────────────────────────────────
    camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z)

    if (rt.thirdPerson) {
      // PointerLockControls owns rotation; the boom only moves the camera back
      // along the direction it is already looking, so both modes share one
      // aiming model and switching does not change where you are pointing.
      camera.getWorldDirection(forwardVec.current)
      const eye = { x: p.pos.x, y: p.pos.y + EYE_HEIGHT, z: p.pos.z }
      // Swept against the same colliders that stop the player — a boom tested
      // against a different set will eventually disagree with the world.
      const wanted = boomDistance(eye, forwardVec.current, colliders)
      boom.current = smoothBoom(boom.current, wanted, dt)
      camera.position.addScaledVector(forwardVec.current, -boom.current)
    } else if (boom.current !== 0) {
      boom.current = 0
    }

    // ── 8b. Laser weapon raycasting + heat ───────────────────────────────────
    updateLaser(camera, dt)

    // ── 9. Interaction targeting ─────────────────────────────────────────────
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

    // ── 10. Drive the meshes the simulation owns ──────────────────────────────
    const refs = rt.refs
    if (refs.car) refs.car.position.y = carY
    if (refs.capybara) {
      refs.capybara.position.set(rt.capybara.x, 0, rt.capybara.z)
      refs.capybara.rotation.y = rt.capybara.heading
    }

    // leafOffset is the shared source of truth with slidingDoorColliders, so
    // what you see and what blocks you cannot disagree.
    const carLeaf = leafOffset(SHAFT.halfWidth, carOpen)
    if (refs.carDoorLeft) refs.carDoorLeft.position.x = -carLeaf
    if (refs.carDoorRight) refs.carDoorRight.position.x = carLeaf

    const entLeaf = leafOffset(ENTRANCE.halfWidth, rt.entranceDoor.openness)
    if (refs.entranceLeft) refs.entranceLeft.position.x = -entLeaf
    if (refs.entranceRight) refs.entranceRight.position.x = entLeaf

    // ── 11. Audio listener ───────────────────────────────────────────────────
    // Must run after the move resolves: footstep cadence is derived from the
    // position delta, so an earlier call would step to last frame's position.
    cityAudio.update(p, dt)

    // ── 12. Perf sampling + throttled HUD mirror ─────────────────────────────
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
      const tourGuidance = cityTourWayfinding(hud.cityTour, p.pos, p.forward)
      const tourTarget = cityTourTarget(hud.cityTour, p.pos)

      const next = {
        promptLabel: rt.target?.label ?? null,
        promptKind: rt.target?.kind ?? null,
        promptPayload: rt.target?.payload ?? null,
        floorLabel: label,
        elevatorPhase: rt.elevator.phase,
        fps: Math.round(perf.fps),
        frameMs: Math.round(perf.frameMs * 10) / 10,
        tourBearing: tourGuidance?.bearing ?? null,
        tourDistance: tourGuidance?.distance ?? null,
        mapPlayerX: Math.round(p.pos.x * 4) / 4,
        mapPlayerZ: Math.round(p.pos.z * 4) / 4,
        mapHeading: Math.round(minimapHeading(p.forward) / 5) * 5,
        mapTargetX: tourTarget?.x ?? null,
        mapTargetZ: tourTarget?.z ?? null,
        weaponHeat: Math.round(p.heat * 10) / 10,
        weaponOverheated: p.overheated,
        weaponFiring: p.firing,
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
