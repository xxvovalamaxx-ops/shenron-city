/**
 * The gameplay director: turns what happens in the world into GTA's layer of
 * consequences and goals.
 *
 *   crimes (vehicle events) → wanted level → HUD stars
 *   police sight lines      → search circle / escape
 *   job board               → pick-up coronas → objectives → GPS waypoint
 *                           → MISSION PASSED + cash, or MISSION FAILED
 *
 * All the rules live in the pure modules (`wanted/`, `missions/`,
 * `mission-catalog`); this component only gathers the per-frame snapshot,
 * calls them, and mirrors the results to the HUD, the radar waypoint and the
 * world markers. It runs right after GameLoop (priority -90), outside React
 * state.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { rt } from '../runtime'
import { stepDt } from '../player/sim-step'
import { vehicleSim } from '../vehicles/vehicle-session'
import { speedKmh } from '../vehicles/vehicle-model'
import { useHud, inputLocked } from '../../ui/hud-store'
import { streetDataNow } from '../../ui/radar/street-data'
import { STREET_SPAWNS } from '../player/spawn-points'
import { manhattanCollision } from '../../world/manhattan-collision'
import { MissionMarkers, setMarkers, type WorldMarker } from '../../world/MissionMarkers'
import { manhattanVehicleWorld } from '../../world/manhattan-vehicle-world'
import { cityAudio } from '../../audio'
import {
  canSee,
  createWanted,
  isSearching,
  reportCrime,
  stepWanted,
  type Crime,
  type Observer,
  type Vec2,
} from '../wanted/wanted'
import { clearDispatch, stepDispatch, unitObservers } from '../wanted/police-dispatch'
import {
  atMissionStart,
  objectiveTarget,
  startMission,
  stepMission,
  timeRemaining,
  type MissionEvent,
} from '../missions/missions'
import { buildMissionCatalog } from './mission-catalog'
import { director, policeObservers } from './director-state'

/** Job pick-ups further than this are not drawn. */
const PICKUP_DRAW_RANGE = 900
/** A failed job waits this long before its corona accepts you again. */
const RETRY_COOLDOWN = 6
/** Sight checks cost a collision sweep each; four a second is plenty. */
const SIGHT_INTERVAL = 0.25
/** The same crime is not counted twice inside this window (scraping along a car). */
const CRIME_REPEAT = 1.5
/** Collisions slower than this (m/s closing speed) are nudges, not crimes. */
const CRIME_IMPACT = 4
/** What an arrest costs. */
const BUST_FINE = 500

/** Police cars in LION traffic, as observers: they see crimes too. */
function trafficPolice(): Observer[] {
  const out: Observer[] = []
  for (const view of vehicleSim.traffic) {
    if (view.kind !== 'police') continue
    out.push({ pos: { x: view.x, z: view.z }, forward: { x: Math.sin(view.heading), z: Math.cos(view.heading) } })
  }
  return out
}

/**
 * Line of sight at chest height: sweep a thin body from the observer toward
 * the player through the building collision; a wall stops it short.
 */
function occluded(from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  if (length < 1) return false
  const moved = manhattanCollision.move({ x: from.x, y: 13.4, z: from.z }, dx, dz, 0.2)
  return Math.hypot(moved.x - from.x, moved.z - from.z) < length - 1.5
}

function playerVehicleKind(): { kind: string | null; kmh: number } {
  const id = vehicleSim.registry.playerVehicleId
  if (id === null) return { kind: null, kmh: 0 }
  const vehicle = vehicleSim.registry.vehicles.get(id)
  if (!vehicle) return { kind: null, kmh: 0 }
  return { kind: vehicle.kind, kmh: Math.abs(speedKmh(vehicle.motion.speed)) }
}

export function GameDirector() {
  const mem = useRef({
    sightClock: 0,
    spotted: false,
    markerKey: '',
    waypointKey: '',
    hudWanted: -1,
    hudFlashing: false,
    lastPlayer: null as Vec2 | null,
    crimeClock: new Map<Crime, number>(),
  })

  const commitMarkers = (list: WorldMarker[]) => {
    const key = list.map((m) => `${m.id}:${m.x.toFixed(1)},${m.z.toFixed(1)}`).join('|')
    if (key === mem.current.markerKey) return
    mem.current.markerKey = key
    setMarkers(list)
  }

  const commitWaypoint = (target: Vec2 | null) => {
    const key = target ? `${target.x.toFixed(1)},${target.z.toFixed(1)}` : ''
    if (key === mem.current.waypointKey) return
    const hud = useHud.getState()
    // Only clear a waypoint the director set; a player-placed one stays.
    if (!target && mem.current.waypointKey && hud.waypoint) hud.setWaypoint(null)
    if (target) hud.setWaypoint(target)
    mem.current.waypointKey = key
  }

  const setObjective = (text: string | null, timeLeft: number | null) => {
    const rounded = timeLeft === null ? null : Math.ceil(timeLeft)
    if (text === director.objectiveText && rounded === director.timeLeft) return
    director.objectiveText = text
    director.timeLeft = rounded
    director.revision += 1
  }

  const handleMissionEvents = (events: MissionEvent[]) => {
    const hud = useHud.getState()
    const at = { x: rt.player.pos.x, y: rt.player.pos.y + 1, z: rt.player.pos.z }
    for (const event of events) {
      switch (event.type) {
        case 'started':
          hud.showBanner(event.title.toUpperCase(), null, { kind: 'info', durationMs: 2600 })
          cityAudio.play('elevatorArrive', at)
          break
        case 'objective':
          director.objectiveText = event.text
          director.revision += 1
          break
        case 'checkpoint':
          cityAudio.play('elevatorArrive', at)
          break
        case 'passed':
          hud.showBanner('MISSION PASSED', `$${event.reward.toLocaleString('en-US')}`, { kind: 'passed' })
          hud.addMoney(event.reward)
          director.completed.add(event.missionId)
          cityAudio.play('elevatorArrive', at)
          break
        case 'failed':
          hud.showBanner('MISSION FAILED', event.reason, { kind: 'failed' })
          director.retryCooldown = RETRY_COOLDOWN
          break
      }
    }
  }

  useFrame((_, rawDt) => {
    const hud = useHud.getState()
    if (inputLocked(hud.screen) || rt.captureFrozen || rt.introSeconds < 4.6) {
      director.inbox.length = 0
      return
    }
    // Same step as GameLoop (including the dev fixed step), so clocks agree.
    const dt = stepDt(rawDt, 1 / 20)
    const player: Vec2 = { x: rt.player.pos.x, z: rt.player.pos.z }

    // ── The job board, once the street graph is here ─────────────────────
    if (director.catalog.length === 0) {
      const data = streetDataNow()
      const anchor = STREET_SPAWNS[0]
      if (data && anchor) director.catalog = buildMissionCatalog(data, anchor, anchor.facing)
    }

    // ── Police sight ─────────────────────────────────────────────────────
    const m = mem.current
    const observers = [...unitObservers(director.dispatch, vehicleSim), ...trafficPolice(), ...policeObservers()]
    m.sightClock -= dt
    if (m.sightClock <= 0) {
      m.sightClock = SIGHT_INTERVAL
      m.spotted = observers.some((o) => canSee(o, player, occluded))
    }
    const playerVel = m.lastPlayer
      ? { x: (player.x - m.lastPlayer.x) / dt, z: (player.z - m.lastPlayer.z) / dt }
      : { x: 0, z: 0 }
    m.lastPlayer = { ...player }

    // ── Crimes ───────────────────────────────────────────────────────────
    const registry = vehicleSim.registry
    const playerCar = registry.playerVehicleId
    // A police car in this frame's vehicle contacts makes any hit a hit on the police.
    let policeContact = false
    for (const event of director.inbox) {
      if (event.type !== 'collision-vehicle') continue
      const v = registry.vehicles.get(event.vehicleId)
      if (v && v.kind === 'police' && v.id !== playerCar) policeContact = true
    }
    for (const [crime, t] of m.crimeClock) m.crimeClock.set(crime, t - dt)
    for (const event of director.inbox) {
      let crime: Crime | null = null
      switch (event.type) {
        case 'collision-pedestrian':
          if (event.vehicleId === playerCar) crime = 'hit-pedestrian'
          break
        case 'promote': {
          // Pulled out of traffic: a carjack, or worse, a cruiser.
          const v = registry.vehicles.get(event.vehicleId)
          crime = v?.kind === 'police' ? 'hit-police-vehicle' : 'carjack'
          break
        }
        case 'enter': {
          const v = registry.vehicles.get(event.vehicleId)
          if (v && v.kind === 'police' && !v.owned) crime = 'hit-police-vehicle'
          break
        }
        case 'collision-traffic': {
          if (event.vehicleId !== playerCar || (event.impact ?? 0) < CRIME_IMPACT) break
          const view = vehicleSim.traffic.find((t) => t.id === event.trafficId)
          crime = view?.kind === 'police' ? 'hit-police-vehicle' : 'hit-vehicle'
          break
        }
        case 'collision-vehicle':
          if (event.vehicleId === playerCar && (event.impact ?? 0) >= CRIME_IMPACT) {
            crime = policeContact ? 'hit-police-vehicle' : 'hit-vehicle'
          }
          break
        default:
          break
      }
      if (!crime || (m.crimeClock.get(crime) ?? 0) > 0) continue
      m.crimeClock.set(crime, CRIME_REPEAT)
      const witnessed = observers.some((o) => canSee(o, player, occluded))
      director.wanted = reportCrime(director.wanted, { crime, at: player, witnessedByPolice: witnessed })
    }
    director.inbox.length = 0
    director.wanted = stepWanted(director.wanted, { spotted: m.spotted, player, dt })

    // ── Police on the road ───────────────────────────────────────────────
    const onFoot = registry.playerVehicleId === null && vehicleSim.playerVisible
    const dispatch = stepDispatch(director.dispatch, vehicleSim, manhattanVehicleWorld, streetDataNow(), {
      stars: director.wanted.stars,
      spotted: m.spotted,
      player,
      playerVel,
      onFoot,
      dt,
    })
    if (dispatch.busted) {
      const fine = Math.min(hud.money, BUST_FINE)
      hud.showBanner('BUSTED', fine > 0 ? `-$${fine}` : null, { kind: 'failed', durationMs: 4200 })
      if (fine > 0) hud.addMoney(-fine)
      director.wanted = createWanted()
      clearDispatch(director.dispatch, vehicleSim)
      if (director.active && director.active.state.status === 'active') {
        director.active.state = { ...director.active.state, status: 'failed', failReason: 'Busted.' }
        director.retryCooldown = RETRY_COOLDOWN
      }
      // Released a block from where it happened, like being let out of the precinct.
      const release = STREET_SPAWNS[0]
      if (release) {
        rt.player.pos.x = release.x
        rt.player.pos.z = release.z
        m.lastPlayer = { x: release.x, z: release.z }
      }
    }

    const stars = director.wanted.stars
    const flashing = isSearching(director.wanted)
    if (stars !== m.hudWanted || flashing !== m.hudFlashing) {
      m.hudWanted = stars
      m.hudFlashing = flashing
      hud.setWanted(stars, flashing)
    }

    // ── Jobs ─────────────────────────────────────────────────────────────
    director.retryCooldown = Math.max(0, director.retryCooldown - dt)
    const active = director.active
    if (active && active.state.status === 'active') {
      const vehicle = playerVehicleKind()
      const step = stepMission(active.def, active.state, {
        player,
        vehicleKind: vehicle.kind,
        speedKmh: vehicle.kmh,
        wantedStars: stars,
        dt,
      })
      active.state = step.state
      handleMissionEvents(step.events)
      if (active.state.status === 'active') {
        const target = objectiveTarget(active.def, active.state)
        setObjective(director.objectiveText, timeRemaining(active.def, active.state))
        commitWaypoint(target)
        const objective = active.def.objectives[active.state.objective]
        const markers: WorldMarker[] = []
        if (target && objective) {
          if (objective.kind === 'checkpoints') {
            markers.push({ id: 'cp', x: target.x, z: target.z, radius: objective.radius, style: 'checkpoint' })
            const next = objective.points[active.state.checkpoint + 1]
            if (next) markers.push({ id: 'cp-next', x: next.x, z: next.z, radius: objective.radius * 0.8, style: 'checkpoint' })
          } else {
            const radius = objective.kind === 'goto' || objective.kind === 'drive-to' ? objective.radius : 4
            markers.push({ id: 'target', x: target.x, z: target.z, radius, style: 'destination' })
          }
        }
        commitMarkers(markers)
      } else {
        director.active = null
        setObjective(null, null)
        commitWaypoint(null)
        commitMarkers([])
      }
      return
    }

    // No job running: draw nearby pick-ups and start one on contact.
    const pickups: WorldMarker[] = []
    for (const def of director.catalog) {
      if (director.completed.has(def.id)) continue
      if (Math.hypot(def.start.x - player.x, def.start.z - player.z) > PICKUP_DRAW_RANGE) continue
      pickups.push({ id: def.id, x: def.start.x, z: def.start.z, radius: 1.6, style: 'mission' })
      if (director.retryCooldown === 0 && atMissionStart(def, player)) {
        const started = startMission(def)
        director.active = { def, state: started.state }
        handleMissionEvents(started.events)
        return
      }
    }
    commitMarkers(pickups.slice(0, 6))
  }, -90)

  return <MissionMarkers />
}
