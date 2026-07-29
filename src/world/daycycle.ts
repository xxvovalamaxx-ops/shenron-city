/**
 * Time of day and weather.
 *
 * The city was permanently 10 pm. Every reference the owner gave spans sunset,
 * night, rain and clear morning, and a city that can only be one of those is a
 * diorama rather than a place.
 *
 * This is the single source for anything the hour or the weather changes: sun
 * direction, light colours and intensities, sky and fog, and how wet the
 * ground is. Rendering, audio and the road material all read it, so they
 * cannot disagree about whether it is raining.
 *
 * Pure and renderer-free — a lighting rig is exactly the kind of thing that
 * looks fine in one screenshot and is broken at 3 am, so the curve is tested
 * across the whole day rather than eyeballed at one hour.
 */

/** Hours, 0..24. 12 is noon. */
export type Hour = number

export interface SunState {
  /** Unit vector toward the sun. y < 0 means it is below the horizon. */
  x: number
  y: number
  z: number
  /** 0 at night, 1 at high noon. Smooth through the horizon. */
  elevation: number
}

export interface SkyState {
  /** Scene background and far fog. */
  horizon: string
  /** Upper hemisphere. */
  zenith: string
  /** Key light colour and intensity. */
  keyColour: string
  keyIntensity: number
  /** Omnidirectional fill. Kept low so the city keeps its form. */
  fillIntensity: number
  /** How lit the city's own windows read: 1 at night, 0 in daylight. */
  practicals: number
}

export interface Weather {
  /** 0 dry, 1 downpour. */
  rain: number
  /** 0 dry ground, 1 standing water. Lags rain — roads stay wet after it stops. */
  wetness: number
}

export const DAWN = 6
export const DUSK = 19.5

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Wrap any number of hours into 0..24 so a running clock never falls off. */
export function normaliseHour(hour: Hour): Hour {
  if (!Number.isFinite(hour)) return 12
  return ((hour % 24) + 24) % 24
}

/**
 * Sun direction for an hour.
 *
 * A simple arc: up in the east at dawn, south at noon, down in the west at
 * dusk. Not an ephemeris — this is a game city, and a believable arc matters
 * more than an accurate one.
 */
export function sunAt(hour: Hour): SunState {
  const h = normaliseHour(hour)
  // Map the day to a half turn, so noon is overhead.
  const t = (h - DAWN) / (DUSK - DAWN)
  const angle = t * Math.PI
  const y = Math.sin(angle)
  const x = Math.cos(angle)

  return {
    x: -x,
    y,
    // A slight tilt, so shadows are never perfectly axis-aligned with the grid.
    z: 0.35 * Math.cos(angle * 0.5),
    elevation: clamp01(y),
  }
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const k = clamp01(t)
  const c = (shift: number) => {
    const ca = (pa >> shift) & 255
    const cb = (pb >> shift) & 255
    return Math.round(lerp(ca, cb, k))
  }
  const to = (v: number) => v.toString(16).padStart(2, '0')
  return `#${to(c(16))}${to(c(8))}${to(c(0))}`
}

const NIGHT = { horizon: '#0b1626', zenith: '#05070d', key: '#c3d6f5' }
const GOLDEN = { horizon: '#ffb066', zenith: '#2c4a76', key: '#ffb877' }
const DAY = { horizon: '#9dc4e8', zenith: '#4a86c8', key: '#fff6e6' }

/**
 * Sky and lighting for an hour.
 *
 * Golden hour is deliberately narrow and strong. It is the look in most of the
 * reference images, and a wide gentle sunset reads as a colour-graded
 * afternoon rather than as a specific time.
 */
export function skyAt(hour: Hour, weather: Weather = { rain: 0, wetness: 0 }): SkyState {
  const h = normaliseHour(hour)
  const sun = sunAt(h)

  // How close to the horizon the sun is while still up.
  const golden = sun.elevation > 0 ? clamp01(1 - Math.abs(sun.elevation - 0.18) / 0.28) : 0
  const day = clamp01((sun.elevation - 0.12) / 0.4)
  const night = clamp01(1 - sun.elevation / 0.1)

  let horizon = mix(NIGHT.horizon, DAY.horizon, day)
  let zenith = mix(NIGHT.zenith, DAY.zenith, day)
  let key = mix(NIGHT.key, DAY.key, day)

  horizon = mix(horizon, GOLDEN.horizon, golden * 0.85)
  zenith = mix(zenith, GOLDEN.zenith, golden * 0.5)
  key = mix(key, GOLDEN.key, golden * 0.9)

  // Rain flattens everything: less key, more fill, greyer sky.
  const rain = clamp01(weather.rain)
  const keyIntensity = lerp(0.12, 2.6, sun.elevation) * lerp(1, 0.35, rain)
  const fillIntensity = lerp(0.2, 0.85, sun.elevation) * lerp(1, 1.5, rain)

  return {
    horizon: mix(horizon, '#6b7480', rain * 0.45),
    zenith: mix(zenith, '#55606d', rain * 0.5),
    keyColour: key,
    keyIntensity,
    fillIntensity,
    practicals: night,
  }
}

/**
 * Advance the weather.
 *
 * Wetness rises fast and dries slowly — the reference images are all
 * rain-soaked streets after the rain, not during it, and a road that goes dry
 * the instant the rain stops throws away the best-looking state there is.
 */
export function stepWeather(current: Weather, rainTarget: number, dt: number): Weather {
  const target = clamp01(rainTarget)
  const rain = Number.isFinite(current.rain) ? current.rain : 0
  const wet = Number.isFinite(current.wetness) ? current.wetness : 0
  const step = Math.max(0, Math.min(dt, 1))

  const nextRain = rain + (target - rain) * clamp01(step * 0.35)
  // Soaks in ~8 s, dries over ~2 min.
  const rate = target > wet ? 0.125 : 0.008
  const nextWet = clamp01(wet + (target - wet) * clamp01(step * rate * 8))

  return { rain: clamp01(nextRain), wetness: nextWet }
}

/** Road roughness for a wetness. Wet asphalt is a mirror; dry asphalt is not. */
export function roadRoughness(wetness: number): number {
  return lerp(0.92, 0.12, clamp01(wetness))
}

/** Road reflectivity for a wetness. */
export function roadMetalness(wetness: number): number {
  return lerp(0.02, 0.55, clamp01(wetness))
}
