/**
 * The in-game HUD, GTA-style.
 *
 *   top-left      context prompt ("Press E to enter the Sedan")
 *   top-right     clock, money, wanted stars
 *   centre        mission banner (MISSION PASSED …)
 *   bottom-left   radar, with health and armor underneath
 *   bottom-right  street and district; vehicle name and speed when driving
 *
 * The debug readouts that used to sit across the top (position, heading,
 * camera mode, dev-tools hint) live in the F3 performance overlay now.
 */
import { useEffect, useRef, useState } from 'react'
import { useHud, type HudBanner } from './hud-store'
import { cityHud } from '../city/city-hud.js'
import { cityWorld } from '../city/registry.js'
import { rt } from '../gameplay/runtime'
import { look } from '../gameplay/player/look-state'
import { vehicleSim } from '../gameplay/vehicles/vehicle-session'
import { vehicleSpec } from '../gameplay/vehicles/vehicle-specs'
import { Radar } from './radar/Radar'
import { nearestStreet, streetDataNow } from './radar/street-data'
import { formatClock, formatMoney, titleCase } from './radar/radar-math'

export function Hud() {
  const showPerf = useHud((s) => s.showPerf)

  return (
    <div className="overlay gta-hud">
      <ContextPrompt />
      <TopRight />
      <MissionBanner />
      <Radar />
      <BottomRight />
      <AimReticle />
      {showPerf && <PerfPanel />}
    </div>
  )
}

/** "Press E to enter the Sedan" → the key drawn as a keycap. */
function PromptText({ text }: { text: string }) {
  const match = /^(.*?\b(?:Press|Hold)\s+)([A-Z0-9]{1,5})(\b.*)$/.exec(text)
  if (!match) return <>{text}</>
  return (
    <>
      {match[1]}
      <kbd className="gta-key">{match[2]}</kbd>
      {match[3]}
    </>
  )
}

function ContextPrompt() {
  const promptLabel = useHud((s) => s.promptLabel)
  if (!promptLabel) return null
  return (
    <div className="gta-prompt" role="status">
      <PromptText text={promptLabel} />
    </div>
  )
}

/** Sample something off the frame state a few times a second. */
function usePoll<T>(read: () => T, ms: number): T {
  const [value, setValue] = useState(read)
  const reader = useRef(read)
  reader.current = read
  useEffect(() => {
    const id = setInterval(() => setValue(reader.current()), ms)
    return () => clearInterval(id)
  }, [ms])
  return value
}

function TopRight() {
  const money = useHud((s) => s.money)
  const wanted = useHud((s) => s.wanted)
  const flashing = useHud((s) => s.wantedFlashing)
  const clock = usePoll(() => formatClock(rt.clock.hour), 1000)
  return (
    <div className="gta-topright">
      <div className="gta-clock">{clock}</div>
      <div className="gta-money">{formatMoney(money)}</div>
      <div className={`gta-wanted ${flashing ? 'flashing' : ''}`} aria-label={`Wanted level ${wanted} of 5`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <svg key={i} viewBox="0 0 24 24" className={i < wanted ? 'star on' : 'star'}>
            <path d="M12 2.2l2.95 6.3 6.85.8-5.08 4.72 1.36 6.78L12 17.4l-6.08 3.4 1.36-6.78L2.2 9.3l6.85-.8z" />
          </svg>
        ))}
      </div>
    </div>
  )
}

function BottomRight() {
  const speed = useHud((s) => s.vehicleSpeedKmh)
  const named = useHud((s) => s.vehicleName)
  const where = usePoll(() => {
    const data = streetDataNow()
    const p = rt.player.pos
    const street = data ? nearestStreet(data, p.x, p.z) : null
    let district = ''
    const city = cityWorld.city
    if (city) {
      const i = city.nearest(p.x, p.z, 350)
      if (i >= 0) district = city.district(i)
    }
    return { street: street ? titleCase(street.name) : '', district: prettyDistrict(district) }
  }, 1000)
  const driving = vehicleSim.registry.playerVehicleId !== null
  const vehicle = driving ? vehicleSim.registry.vehicles.get(vehicleSim.registry.playerVehicleId!) : null
  const name = named ?? (vehicle ? vehicleSpec(vehicle.kind).label : null)

  return (
    <div className="gta-bottomright">
      {driving && (
        <div className="gta-vehicle">
          {name && <div className="gta-vehicle-name">{name}</div>}
          <div className="gta-speed">
            <b>{speed}</b>
            <span>KM/H</span>
          </div>
        </div>
      )}
      {(where.street || where.district) && (
        <div className="gta-location">
          {where.district && <div className="gta-district">{where.district}</div>}
          {where.street && <div className="gta-street">{where.street}</div>}
        </div>
      )}
    </div>
  )
}

function prettyDistrict(name: string): string {
  if (!name || name === 'Context') return ''
  // "Midtown-Times Square" → "Midtown · Times Square"
  return name.replace(/\s*-\s*/g, ' · ')
}

function MissionBanner() {
  const banner = useHud((s) => s.banner)
  const [shown, setShown] = useState<HudBanner | null>(null)
  useEffect(() => {
    if (!banner) {
      setShown(null)
      return
    }
    setShown(banner)
    const wait = Math.max(0, banner.until - performance.now())
    const id = setTimeout(() => {
      if (useHud.getState().banner?.id === banner.id) useHud.getState().clearBanner()
    }, wait)
    return () => clearTimeout(id)
  }, [banner])
  if (!shown) return null
  return (
    <div key={shown.id} className={`gta-banner ${shown.kind}`} role="status">
      <div className="gta-banner-title">{shown.title}</div>
      {shown.subtitle && <div className="gta-banner-sub">{shown.subtitle}</div>}
    </div>
  )
}

/** A small reticle while aiming; toggled by class on its own frame, no React churn. */
function AimReticle() {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let on = false
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const want = look.aiming && rt.thirdPerson
      if (want !== on && el.current) {
        on = want
        el.current.classList.toggle('on', on)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <div ref={el} className="gta-reticle" aria-hidden="true" />
}

function PerfPanel() {
  const perf = useHud((s) => s)
  const [, setTick] = useState(0)

  // The engine writes cityHud at ~2 Hz; poll it at the same cadence rather
  // than re-rendering sixty times a second.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  return (
    <aside className="perf" aria-live="off">
      <b>
        {perf.fps} FPS · {perf.frameMs} ms
      </b>
      <span>
        {perf.mapPlayerX}, {perf.mapPlayerZ} · {perf.mapHeading}° ·{' '}
        {perf.thirdPerson ? 'third person' : 'first person'} (V)
      </span>
      {cityWorld.ready && (
        <>
          <span>{cityHud.tiles}</span>
          <span>{cityHud.lod}</span>
          <span>{cityHud.cars}</span>
          <span>{cityHud.peds}</span>
          <span>{cityHud.props} props drawn</span>
          <span>{cityHud.sky}</span>
          <span>{cityHud.where}</span>
        </>
      )}
      <span>F2 dev tools · Double-Space fly · Shift sprint · RMB aim · Esc map</span>
    </aside>
  )
}
