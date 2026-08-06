/**
 * Drives the game clock and the weather schedule.
 *
 * The visual side of the sky — sun, fog, clouds, rain, exposure — is owned by
 * the ported Weather engine (world/ManhattanCity.tsx), which reads this same
 * clock every frame, so the sky and the sim cannot disagree. This component
 * only advances the clock and decides when rain comes and goes, exactly like
 * the old SkyRig did.
 *
 * The clock lives on `rt` rather than in React state: it changes every frame,
 * and putting it in state would re-render the tree sixty times a second.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { rt } from '../gameplay/runtime'
import { stepWeather } from './daycycle'

/** Real seconds per in-game hour. A full day in eight minutes. */
export const SECONDS_PER_HOUR = 20

export function DayCycle() {
  // Rain comes and goes on its own schedule rather than following the clock,
  // so the city is not reliably wet at the same hour every day.
  const nextChange = useRef(45)

  useEffect(() => {
    // Start in late afternoon: the hour the references are mostly shot at,
    // so the first thing the player sees is the city at its best rather than
    // a dead hour.
    if (rt.clock.hour === 0) rt.clock.hour = 17
  }, [])

  useFrame((_, rawDt) => {
    if (rt.paused) return
    const dt = Math.min(rawDt, 1 / 20)

    // Deterministic captures keep the clock pinned at the capture hour.
    if (!rt.captureFrozen) {
      rt.clock.hour = (rt.clock.hour + dt / SECONDS_PER_HOUR) % 24
    }

    nextChange.current -= dt
    if (nextChange.current <= 0) {
      // Dry most of the time; a downpour is an event, not the default.
      rt.clock.rainTarget = Math.random() < 0.35 ? 0.55 + Math.random() * 0.45 : 0
      nextChange.current = 60 + Math.random() * 120
    }
    rt.clock.weather = stepWeather(rt.clock.weather, rt.clock.rainTarget, dt)
  })

  return null
}
