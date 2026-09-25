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
import { vehicleSim } from '../vehicles/vehicle-session'
import { speedKmh } from '../vehicles/vehicle-model'
import { useHud, inputLocked } from '../../ui/hud-store'
import { streetDataNow } from '../../ui/radar/street-data'
import { STREET_SPAWNS } from '../player/spawn-points'
import { manhattanCollision } from '../../world/manhattan-collision'
import { MissionMarkers, setMarkers, type WorldMarker } from '../../world/MissionMarkers'
import { cityAudio } from '../../audio'
import {
  canSee,
  isSearching,
  reportCrime,
  stepWanted,
  type Crime,
  type Vec2,
} from '../wanted/wanted'
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
    const dt = Math.min(rawDt, 1 / 20)
    const player: Vec2 = { x: rt.player.pos.x, z: rt.player.pos.z }

    // ── The job board, once the street graph is here ─────────────────────
    if (director.catalog.length === 0) {
      const data = streetDataNow()
      const anchor = STREET_SPAWNS[0]
      if (data && anchor) director.catalog = buildMissionCatalog(data, anchor, anchor.facing)
    }

    // ── Police sight ─────────────────────────────────────────────────────
    const m = mem.current
    const observers = policeObservers()
    m.sightClock -= dt
    if (m.sightClock <= 0) {
      m.sightClock = SIGHT_INTERVAL
      m.spotted = observers.some((o) => canSee(o, player, occluded))
    }

    // ── Crimes ───────────────────────────────────────────────────────────
    for (const event of director.inbox) {
      let crime: Crime | null = null
      if (event.type === 'collision-pedestrian') crime = 'hit-pedestrian'
      else if (event.type === 'enter') {
        const vehicle = vehicleSim.registry.vehicles.get(event.vehicleId)
        if (vehicle && !vehicle.owned) crime = vehicle.kind === 'police' ? 'hit-police-vehicle' : 'vehicle-theft'
      } else if (event.type === 'collision-vehicle') crime = 'hit-vehicle'
      if (!crime) continue
      const witnessed = observers.some((o) => canSee(o, player, occluded))
      director.wanted = reportCrime(director.wanted, { crime, at: player, witnessedByPolice: witnessed })
    }
    director.inbox.length = 0
    director.wanted = stepWanted(director.wanted, { spotted: m.spotted, player, dt })

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
