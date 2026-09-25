/**
 * The vehicle session's visual layer.
 *
 * The simulation lives in renderer-free modules; this component is the only
 * place a session car is drawn. Each car is a clone of its kind from the
 * vehicle family GLB (world/vehicles/vehicle-assets.ts) with its own paint
 * and lamp materials, and everything that makes driving feel physical but
 * must not touch the deterministic sim happens here:
 *
 * - a visual suspension: body roll from cornering, pitch from braking and
 *   acceleration, heave from bumps and hits (a damped spring per axis);
 * - wheels that spin with the sim's wheel angle and steer with its steering
 *   angle, staying on the road while the body moves on its springs;
 * - lamps: headlights and tail lights for the car being driven, brake lights
 *   that flare, the police lightbar strobing (L toggles it), the taxi sign;
 * - real SpotLights for the player's headlights (a fixed budget created
 *   once, so the scene's light count never changes and nothing recompiles);
 * - skid marks, tyre smoke and crash sparks from the car's slip and the
 *   session's collision events;
 * - the engine, tyre and impact sounds (audio/vehicle-audio.ts).
 *
 * React never re-renders per frame: the rig owns THREE objects and mutates
 * them in useFrame.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { vehicleSim, lastFrameEvents, lastSessionInput, getVehicleHud } from '../gameplay/vehicles/vehicle-session'
import { FIXED_PAINT, paintFor, vehicleSpec } from '../gameplay/vehicles/vehicle-specs'
import type { VehicleEntity } from '../gameplay/vehicles/vehicle-entities'
import { rt } from '../gameplay/runtime'
import { useHud } from '../ui/hud-store'
import {
  createHeroMaterials,
  currentVehicleQuality,
  heroMaterialFor,
  heroZoneOf,
  lightbarStrobe,
  loadVehicleAssets,
  vehicleAssetsIfReady,
  vehicleShaderTime,
  type HeroMaterials,
  type ModelKind,
  type VehicleKindAsset,
  type VehicleQuality,
} from './vehicles/vehicle-assets'
import { SkidMarks, Sparks, TyreSmoke } from './vehicles/vehicle-fx'
import { createSuspension, stepSuspension, type SuspensionState } from './vehicles/vehicle-suspension'
import { vehicleAudio } from '../audio/vehicle-audio'
import { manhattanCollision } from './manhattan-collision'

interface WheelRig {
  tag: string
  pivot: THREE.Group
  spinner: THREE.Group
  front: boolean
  rear: boolean
  /** Last contact point, for joining skid-mark segments. */
  last: THREE.Vector3 | null
  /** Fractional smoke particles owed (emission is per second, not per frame). */
  smokeDebt: number
}

interface HeroEntry {
  kind: string
  group: THREE.Group
  chassis: THREE.Group
  wheels: WheelRig[]
  mats: HeroMaterials
  asset: VehicleKindAsset
  suspension: SuspensionState
  lastSpeed: number
  lastHeading: number
  headlights: THREE.Vector3[]
}

function modelKind(kind: string): ModelKind {
  return vehicleSpec(kind).model as ModelKind
}

function buildHero(entity: VehicleEntity, asset: VehicleKindAsset, quality: VehicleQuality): HeroEntry {
  const paint = entity.paint ?? FIXED_PAINT[entity.kind] ?? paintFor(entity.kind, entity.id * 7 + 3)
  const mats = createHeroMaterials(paint, quality)
  const group = new THREE.Group()
  group.name = `vehicle-${entity.id}`
  const chassis = new THREE.Group()
  group.add(chassis)
  for (const part of asset.bodyParts) {
    const zone = heroZoneOf(part)
    const mesh = new THREE.Mesh(part.geometry, heroMaterialFor(zone, mats, quality))
    mesh.matrixAutoUpdate = false
    mesh.matrix.copy(part.matrix)
    mesh.castShadow = zone !== 'glass' && zone !== 'interior'
    mesh.receiveShadow = true
    chassis.add(mesh)
  }
  const wheels: WheelRig[] = []
  for (const w of asset.wheels) {
    const pivot = new THREE.Group()
    pivot.position.copy(w.position)
    const spinner = new THREE.Group()
    pivot.add(spinner)
    for (const part of asset.wheelParts) {
      const mesh = new THREE.Mesh(part.geometry, heroMaterialFor(heroZoneOf(part), mats, quality))
      mesh.quaternion.copy(w.quaternion)
      mesh.castShadow = true
      mesh.receiveShadow = true
      spinner.add(mesh)
    }
    group.add(pivot)
    wheels.push({ tag: w.tag, pivot, spinner, front: w.tag[0] === 'F', rear: w.tag[0] === 'R', last: null, smokeDebt: 0 })
  }
  return {
    kind: entity.kind,
    group,
    chassis,
    wheels,
    mats,
    asset,
    suspension: createSuspension(),
    lastSpeed: entity.motion.speed,
    lastHeading: entity.pose.heading,
    headlights: asset.headlights,
  }
}

function disposeHero(entry: HeroEntry): void {
  entry.group.removeFromParent()
  for (const m of entry.mats.owned) m.dispose()
}

function wrapAngle(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _v = new THREE.Vector3()

export function VehicleRig() {
  const root = useRef<THREE.Group>(null)
  const entries = useRef(new Map<number, HeroEntry>())
  const fx = useRef<{ skid: SkidMarks; smoke: TyreSmoke; sparks: Sparks } | null>(null)
  const lights = useRef<{ spots: THREE.SpotLight[]; owner: number | null } | null>(null)
  const siren = useRef(false)
  const clock = useRef(0)
  const { gl, camera } = useThree()

  // Load the family once; the rig draws nothing until it is ready.
  useEffect(() => {
    void loadVehicleAssets().catch((error) => console.warn('[vehicles] model load failed', error))
  }, [])

  // Effects and the headlight budget live for the rig's lifetime.
  useEffect(() => {
    const group = root.current
    if (!group) return
    const skid = new SkidMarks()
    const smoke = new TyreSmoke()
    const sparks = new Sparks()
    group.add(skid.mesh, smoke.points, sparks.points)
    fx.current = { skid, smoke, sparks }
    const map = entries.current
    return () => {
      skid.dispose()
      smoke.dispose()
      sparks.dispose()
      skid.mesh.removeFromParent()
      smoke.points.removeFromParent()
      sparks.points.removeFromParent()
      fx.current = null
      for (const entry of map.values()) disposeHero(entry)
      map.clear()
      if (lights.current) {
        for (const spot of lights.current.spots) {
          spot.removeFromParent()
          spot.target.removeFromParent()
          spot.dispose()
        }
        lights.current = null
      }
      vehicleAudio.stop()
    }
  }, [])

  // L toggles the police lightbar while driving a police car.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyL' || event.repeat) return
      if (useHud.getState().screen !== 'playing') return
      const id = vehicleSim.registry.playerVehicleId
      const entity = id !== null ? vehicleSim.registry.vehicles.get(id) : undefined
      if (entity?.kind === 'police') siren.current = !siren.current
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useFrame((_, rawDt) => {
    const rigRoot = root.current
    const assets = vehicleAssetsIfReady()
    if (!rigRoot || !assets) return
    const dt = rt.paused ? 0 : Math.min(rawDt, 0.05)
    clock.current += dt
    const quality = currentVehicleQuality()

    // The headlight budget: created once (count fixed per session).
    if (!lights.current) {
      const count = quality === 'high' ? 2 : quality === 'medium' ? 1 : 0
      const spots: THREE.SpotLight[] = []
      for (let i = 0; i < count; i++) {
        const spot = new THREE.SpotLight(0xfff0dc, 0, 70, count === 1 ? 0.62 : 0.5, 0.55, 1.4)
        spot.castShadow = false
        spot.name = 'vehicle-headlight'
        rigRoot.add(spot, spot.target)
        spots.push(spot)
      }
      lights.current = { spots, owner: null }
    }

    const playerId = vehicleSim.registry.playerVehicleId
    const heads = vehicleSim.headlightsOn
    const input = lastSessionInput
    const effects = fx.current

    // Keep a hero per session car, created and destroyed with the entity.
    const seen = new Set<number>()
    for (const entity of vehicleSim.registry.vehicles.values()) {
      const asset = assets.kinds.get(modelKind(entity.kind))
      if (!asset) continue
      seen.add(entity.id)
      let entry = entries.current.get(entity.id)
      if (!entry || entry.kind !== entity.kind) {
        if (entry) disposeHero(entry)
        entry = buildHero(entity, asset, quality)
        rigRoot.add(entry.group)
        entries.current.set(entity.id, entry)
      }

      // Pose. A car that was never stepped (a vision capture, a fresh save)
      // may not know its ground height yet.
      let y = entity.pose.pos.y
      if (y === 0) {
        const ground = manhattanCollision.groundHeightAt(entity.pose.pos.x, entity.pose.pos.z)
        if (ground !== null) y = ground
      }
      entry.group.position.set(entity.pose.pos.x, y, entity.pose.pos.z)
      entry.group.rotation.y = entity.pose.heading

      // Suspension from the motion the sim produced this frame.
      const speed = entity.motion.speed
      const yawRate = dt > 0 ? wrapAngle(entity.pose.heading - entry.lastHeading) / dt : 0
      const accel = dt > 0 ? (speed - entry.lastSpeed) / dt : 0
      entry.lastSpeed = speed
      entry.lastHeading = entity.pose.heading
      const spec = vehicleSpec(entity.kind)
      stepSuspension(entry.suspension, {
        longAccel: accel,
        latAccel: speed * yawRate + (entity.motion.burnout ? 0 : 0),
        speed,
        burnout: !!entity.motion.burnout,
        dt,
        mass: spec.mass,
      })
      const s = entry.suspension
      entry.chassis.position.y = s.heave
      entry.chassis.rotation.set(s.pitch, 0, s.roll, 'YXZ')

      // Wheels: spin and steer.
      for (const wheel of entry.wheels) {
        wheel.spinner.rotation.x = entity.motion.wheelSpin * (wheel.front && entity.motion.burnout ? 0 : 1)
        wheel.pivot.rotation.y = wheel.front ? entity.motion.steerAngle : 0
      }

      // Lamps: only a car with somebody at the wheel shows its lights.
      const driven = entity.id === playerId
      const lit = driven && heads
      const braking = driven && (entity.motion.braking || entity.motion.reversing)
      entry.mats.headlight.emissiveIntensity = lit ? 7 : driven ? 0.35 : 0
      entry.mats.taillight.emissiveIntensity = (lit ? 1.4 : 0) + (braking ? 5.5 : 0)
      entry.mats.taxiSign.emissiveIntensity = driven ? (heads ? 2.2 : 0.4) : 0
      // Dispatched cruisers run their lights; the player's toggles with L.
      const strobe = (driven && entity.kind === 'police' && siren.current) || entity.controller === 'pursuit'
      entry.mats.lightbarRed.emissiveIntensity = strobe ? lightbarStrobe(vehicleShaderTime.value, 0) * 14 : 0
      entry.mats.lightbarBlue.emissiveIntensity = strobe ? lightbarStrobe(vehicleShaderTime.value, 0.5) * 14 : 0

      // Tyre effects for anything sliding.
      if (effects && dt > 0) tyreEffects(entry, entity, input, accel, effects, clock.current, dt)
    }
    for (const id of [...entries.current.keys()]) {
      if (!seen.has(id)) {
        disposeHero(entries.current.get(id)!)
        entries.current.delete(id)
      }
    }

    // Player headlights: the fixed spot budget rides the driven car.
    const spots = lights.current.spots
    const playerEntry = playerId !== null ? entries.current.get(playerId) : undefined
    if (spots.length > 0) {
      if (playerEntry && lights.current.owner !== playerId) {
        spots.forEach((spot, i) => {
          const lamp = spots.length === 1
            ? playerEntry.headlights[0].clone().lerp(playerEntry.headlights[1], 0.5)
            : playerEntry.headlights[i]
          playerEntry.chassis.add(spot, spot.target)
          spot.position.set(lamp.x, lamp.y + 0.02, lamp.z + 0.05)
          spot.target.position.set(lamp.x * 1.6, 0, lamp.z + 24)
        })
        lights.current.owner = playerId
      } else if (!playerEntry && lights.current.owner !== null) {
        for (const spot of spots) rigRoot.add(spot, spot.target)
        lights.current.owner = null
      }
      const on = !!playerEntry && heads
      for (const spot of spots) spot.intensity = on ? (spots.length === 1 ? 900 : 520) : 0
    }

    // Collisions: sparks, and the thump.
    if (effects) {
      for (const event of lastFrameEvents) {
        if (event.type !== 'collision-world' && event.type !== 'collision-vehicle' && event.type !== 'collision-traffic') continue
        const impact = event.impact ?? 0
        if (event.vehicleId !== playerId) continue
        if (impact > 1.2) vehicleAudio.impact(Math.min(1, impact / 14))
        if (impact < 3.5) continue
        const entity = vehicleSim.registry.vehicles.get(event.vehicleId)
        if (!entity) continue
        const spec = vehicleSpec(entity.kind)
        const dir = entity.motion.speed >= 0 ? 1 : -1
        const f = { x: Math.sin(entity.pose.heading), z: Math.cos(entity.pose.heading) }
        let px = entity.pose.pos.x + f.x * spec.halfLength * dir
        let pz = entity.pose.pos.z + f.z * spec.halfLength * dir
        if (event.type === 'collision-traffic') {
          const view = vehicleSim.traffic.find((candidate) => candidate.id === event.trafficId)
          if (view) {
            px = (entity.pose.pos.x + view.x) / 2
            pz = (entity.pose.pos.z + view.z) / 2
          }
        }
        const count = Math.min(40, Math.round(impact * 2.5))
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + clock.current * 7.1
          const sp = 3 + ((i * 7919) % 13) * 0.45
          _a.set(px, entity.pose.pos.y + 0.45, pz)
          _v.set(Math.cos(a) * sp - f.x * dir * 2, 1.5 + ((i * 104729) % 7) * 0.5, Math.sin(a) * sp - f.z * dir * 2)
          effects.sparks.emit(_a, _v, clock.current, ((i * 31) % 17) / 17)
        }
      }
      effects.smoke.time = clock.current
      effects.sparks.time = clock.current
      const persp = camera as THREE.PerspectiveCamera
      const scale = (gl.domElement.height / 2) / Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 60) / 2)
      effects.smoke.material.uniforms.uScale.value = scale
      effects.sparks.material.uniforms.uScale.value = scale
      const hour = rt.clock.hour
      const day = Math.max(0, Math.min(1, (Math.min(hour - 5.5, 20 - hour)) / 2.5))
      effects.smoke.setLight(day)
    }

    // Engine, tyres, horn.
    const hud = getVehicleHud()
    const driven = playerEntry && playerId !== null ? vehicleSim.registry.vehicles.get(playerId) : undefined
    vehicleAudio.update({
      active: hud.driving || hud.inVehicle,
      rpmNorm: hud.rpmNorm,
      throttle: hud.throttle,
      speed: Math.abs(hud.speed),
      slip: driven ? slipAmount(driven) : 0,
      horn: hud.driving && input.hornHeld,
      shiftedUp: hud.shiftedUp,
      shiftedDown: hud.shiftedDown,
      kind: hud.kind ?? 'sedan',
      siren: !!driven && driven.kind === 'police' && siren.current,
    }, dt)
  })

  return <group name="vehicle-rig" ref={root} />
}

/** 0..1 how hard the tyres are sliding. */
function slipAmount(entity: VehicleEntity): number {
  const m = entity.motion
  if (m.burnout) return 1
  const slide = Math.max(0, Math.abs(m.lateral) - 0.8) / 2.2
  return Math.min(1, slide)
}

function tyreEffects(
  entry: HeroEntry,
  entity: VehicleEntity,
  input: typeof lastSessionInput,
  accel: number,
  effects: { skid: SkidMarks; smoke: TyreSmoke; sparks: Sparks },
  time: number,
  dt: number,
): void {
  const m = entity.motion
  const speed = Math.abs(m.speed)
  const driven = entity.id === vehicleSim.registry.playerVehicleId
  const handbrake = driven && input.handbrake && speed > 2.5
  const slide = Math.abs(m.lateral)
  const hardBrake = accel < -9.5 && speed > 4
  const burnout = !!m.burnout
  const marking = slide > 0.9 || handbrake || hardBrake || burnout
  const smoking = slide > 1.6 || burnout || (handbrake && speed > 7)
  const strength = Math.min(1, 0.35 + slide * 0.2 + (burnout ? 0.6 : 0) + (handbrake ? 0.25 : 0))
  const spec = vehicleSpec(entity.kind)
  for (const wheel of entry.wheels) {
    // front wheels only mark under hard braking
    const marks = wheel.rear ? marking : hardBrake
    wheel.pivot.getWorldPosition(_b)
    _b.y = entity.pose.pos.y
    if (!marks) {
      wheel.last = null
      continue
    }
    if (wheel.last) {
      effects.skid.add(wheel.last, _b, 0.22 + spec.halfWidth * 0.02, strength)
    }
    wheel.last = (wheel.last ?? new THREE.Vector3()).copy(_b)
    if (wheel.rear && smoking) {
      wheel.smokeDebt += (burnout ? 70 : 38 + slide * 8) * dt
      const rate = Math.floor(wheel.smokeDebt)
      wheel.smokeDebt -= rate
      for (let i = 0; i < rate; i++) {
        const seed = (time * 13.7 + i * 0.37 + (wheel.tag === 'RL' ? 0.5 : 0)) % 1
        _a.copy(_b)
        _a.y += 0.25
        const back = -(m.speed >= 0 ? 1 : -1)
        _v.set(
          Math.sin(entity.pose.heading) * back * 1.5 + (seed - 0.5) * 1.6,
          0.4 + seed * 0.5,
          Math.cos(entity.pose.heading) * back * 1.5 + (0.5 - seed) * 1.6,
        )
        effects.smoke.emit(_a, _v, time, seed)
      }
    }
  }
}
