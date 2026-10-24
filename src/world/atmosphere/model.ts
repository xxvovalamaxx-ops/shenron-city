/**
 * The atmosphere as a pure function of the clock and the weather.
 *
 * Everything the light does over a day is decided here, in one table keyed by
 * the sun's elevation rather than by the hour: the key light, the sky dome,
 * the haze, the image-based ambient, the exposure and the bloom. Keying on
 * elevation is what makes dawn and dusk agree with each other and with the
 * sun disk actually on screen — an hour-keyed table drifts the moment the sun
 * path is retuned.
 *
 * The sun follows a real solar arc for Manhattan's latitude (40.7 N) with a
 * late-summer declination, so shadows swing the right way down the grid, and
 * golden hour, blue hour and night fall where the art direction wants them:
 * 17:30 golden, 20:00 deep blue hour, 23:00 night.
 *
 * Pure and renderer-free. Colours are linear-light RGB triples (the shaders
 * and three's lights work in linear), authored as sRGB hex for readability.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Manhattan latitude. */
const LATITUDE = (40.7 * Math.PI) / 180
/** Late-summer declination: sunset near 18:40, a long blue hour after it. */
const SUN_DECLINATION = (6 * Math.PI) / 180
/** Clock time of solar noon (daylight-saving shifted). */
const SOLAR_NOON = 12.3
/** A waning gibbous moon: rises in the east after sunset, south-east by 23:00. */
const MOON_DECLINATION = (-12 * Math.PI) / 180
const MOON_LAG_DEG = 205

const DEG = 180 / Math.PI

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return 12
  return ((hour % 24) + 24) % 24
}

/**
 * Direction toward a body on the celestial sphere, in world axes.
 *
 * World: +x east, +y up, +z south (the city's z is minus the survey north).
 */
export function celestialDirection(hourAngleRad: number, declinationRad: number): Vec3 {
  const cosD = Math.cos(declinationRad)
  const sinD = Math.sin(declinationRad)
  const east = -cosD * Math.sin(hourAngleRad)
  const north = sinD * Math.cos(LATITUDE) - cosD * Math.cos(hourAngleRad) * Math.sin(LATITUDE)
  const up = sinD * Math.sin(LATITUDE) + cosD * Math.cos(hourAngleRad) * Math.cos(LATITUDE)
  const len = Math.hypot(east, north, up) || 1
  return { x: east / len, y: up / len, z: -north / len }
}

/** Unit vector toward the sun for a clock hour. */
export function sunDirection(hour: number): Vec3 {
  const h = wrapHour(hour)
  const hourAngle = ((h - SOLAR_NOON) * 15 * Math.PI) / 180
  return celestialDirection(hourAngle, SUN_DECLINATION)
}

/** Unit vector toward the moon for a clock hour. */
export function moonDirection(hour: number): Vec3 {
  const h = wrapHour(hour)
  const hourAngle = (((h - SOLAR_NOON) * 15 - MOON_LAG_DEG) * Math.PI) / 180
  return celestialDirection(hourAngle, MOON_DECLINATION)
}

export function elevationDeg(dir: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, dir.y))) * DEG
}

/** Compass azimuth in degrees: 0 north, 90 east, 180 south, 270 west. */
export function azimuthDeg(dir: Vec3): number {
  const a = Math.atan2(dir.x, -dir.z) * DEG
  return (a + 360) % 360
}

// ---------------------------------------------------------------- colour --

function hex(h: number): Rgb {
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return { r: toLinear((h >> 16) & 255), g: toLinear((h >> 8) & 255), b: toLinear(h & 255) }
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t)
  return { r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k) }
}

function addRgb(a: Rgb, b: Rgb): Rgb {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b }
}

function scaleRgb(a: Rgb, s: number): Rgb {
  return { r: a.r * s, g: a.g * s, b: a.b * s }
}

export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// ------------------------------------------------------------------ table --

/**
 * One row per sun elevation. Colours are sRGB hex; `sky` scales the dome's
 * radiance so noon can sit above 1.0 (HDR) while night stays deep.
 */
interface Key {
  el: number
  zenith: number
  horizon: number
  hazeSun: number
  hazeAway: number
  sky: number
  sunColor: number
  sunI: number
  envI: number
  exposure: number
}

// prettier-ignore
const KEYS: Key[] = [
  { el: -90, zenith: 0x060b1a, horizon: 0x141c30, hazeSun: 0x1a2032, hazeAway: 0x141c30, sky: 1.0, sunColor: 0xff5020, sunI: 0, envI: 1.6, exposure: 1.2 },
  { el: -18, zenith: 0x070d1f, horizon: 0x172036, hazeSun: 0x1e2438, hazeAway: 0x172036, sky: 1.0, sunColor: 0xff5020, sunI: 0, envI: 1.6, exposure: 1.2 },
  { el: -12, zenith: 0x0a1430, horizon: 0x222e52, hazeSun: 0x303656, hazeAway: 0x202c50, sky: 1.0, sunColor: 0xff5020, sunI: 0, envI: 1.6, exposure: 1.2 },
  { el: -6, zenith: 0x13265c, horizon: 0x44609a, hazeSun: 0x7a6a92, hazeAway: 0x3c5890, sky: 1.0, sunColor: 0xff5020, sunI: 0, envI: 1.6, exposure: 1.18 },
  { el: -2, zenith: 0x203c78, horizon: 0x9090b4, hazeSun: 0xd49474, hazeAway: 0x5c76aa, sky: 1.0, sunColor: 0xff5a24, sunI: 0, envI: 1.6, exposure: 1.15 },
  { el: 0, zenith: 0x2a4c90, horizon: 0xdc9e80, hazeSun: 0xf4a468, hazeAway: 0x7890bc, sky: 1.0, sunColor: 0xff6a2a, sunI: 0.8, envI: 1.55, exposure: 1.1 },
  { el: 4, zenith: 0x3360a8, horizon: 0xe8b894, hazeSun: 0xffbc78, hazeAway: 0x93a8cc, sky: 1.05, sunColor: 0xff8a40, sunI: 2.4, envI: 1.5, exposure: 1.0 },
  { el: 10, zenith: 0x3a6cb8, horizon: 0xe6cbb0, hazeSun: 0xffcf98, hazeAway: 0xa8bcd8, sky: 1.1, sunColor: 0xffa860, sunI: 3.6, envI: 1.45, exposure: 0.95 },
  { el: 18, zenith: 0x3c74c2, horizon: 0xd2dce8, hazeSun: 0xf2e0c4, hazeAway: 0xb4c6de, sky: 1.15, sunColor: 0xffc890, sunI: 4.4, envI: 1.45, exposure: 0.9 },
  { el: 30, zenith: 0x3a78cc, horizon: 0xc0d4ec, hazeSun: 0xe8eae8, hazeAway: 0xb4c8e2, sky: 1.2, sunColor: 0xffdcb4, sunI: 5.0, envI: 1.45, exposure: 0.86 },
  { el: 55, zenith: 0x3676d0, horizon: 0xb8d0ee, hazeSun: 0xe2e8f0, hazeAway: 0xb0c6e2, sky: 1.25, sunColor: 0xffecd8, sunI: 5.4, envI: 1.45, exposure: 0.84 },
  { el: 90, zenith: 0x3474d0, horizon: 0xb4ceee, hazeSun: 0xe0e8f0, hazeAway: 0xaec4e0, sky: 1.25, sunColor: 0xfff0e2, sunI: 5.5, envI: 1.45, exposure: 0.84 },
]

interface Sampled {
  zenith: Rgb
  horizon: Rgb
  hazeSun: Rgb
  hazeAway: Rgb
  sky: number
  sunColor: Rgb
  sunI: number
  envI: number
  exposure: number
}

function sampleKeys(el: number): Sampled {
  const e = Math.max(-90, Math.min(90, el))
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1].el <= e) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = clamp01((e - a.el) / (b.el - a.el))
  return {
    zenith: mixRgb(hex(a.zenith), hex(b.zenith), t),
    horizon: mixRgb(hex(a.horizon), hex(b.horizon), t),
    hazeSun: mixRgb(hex(a.hazeSun), hex(b.hazeSun), t),
    hazeAway: mixRgb(hex(a.hazeAway), hex(b.hazeAway), t),
    sky: lerp(a.sky, b.sky, t),
    sunColor: mixRgb(hex(a.sunColor), hex(b.sunColor), t),
    sunI: lerp(a.sunI, b.sunI, t),
    envI: lerp(a.envI, b.envI, t),
    exposure: lerp(a.exposure, b.exposure, t),
  }
}

// ------------------------------------------------------------------ state --

export interface AtmosphereInput {
  hour: number
  /** 0 clear .. 1 overcast. */
  cover: number
  /** 0 dry .. 1 downpour. */
  rain: number
}

export interface AtmosphereState {
  hour: number
  sun: Vec3
  sunElevation: number
  moon: Vec3
  moonElevation: number
  /** 0 in daylight, 1 once the sun is 12 degrees down. */
  night: number
  /** 1 around sunrise and sunset (sun within about 12 degrees of the horizon). */
  golden: number
  /** Street lights, neon and lit windows: 0 by day, 1 at night. */
  practicals: number

  /** The one shadow-casting key light: the sun by day, the moon by night. */
  keyDir: Vec3
  keyColor: Rgb
  keyIntensity: number
  /** Supplementary lights. Image-based light does the real ambient work. */
  hemiSky: Rgb
  hemiGround: Rgb
  hemiIntensity: number
  fillIntensity: number

  /** Sky dome (linear radiance). */
  zenith: Rgb
  horizon: Rgb
  sunDiskColor: Rgb
  sunDiskIntensity: number
  /** Forward-scatter glow around the sun. */
  mieColor: Rgb
  moonColor: Rgb
  moonIntensity: number
  stars: number
  /** Sodium city glow over the horizon at night, linear radiance. */
  lightPollution: Rgb
  /** Blue fill added to the environment bake's sky at night (not visible). */
  nightAmbient: Rgb

  /** Haze toward and away from the sun, linear. Fog and the dome share them. */
  hazeSun: Rgb
  hazeAway: Rgb
  /** Extinction per metre along the view ray. */
  fogDensity: number
  /** Extra extinction per metre at street level; falls off with altitude. */
  heightFogDensity: number
  /** Height-fog falloff, 1/metres. */
  heightFogFalloff: number
  /** Distance at which the view is fully hazed (hides the streaming edge). */
  fogFar: number

  cover: number
  rain: number
  cloudLit: Rgb
  cloudShade: Rgb

  envIntensity: number
  exposure: number
  bloomIntensity: number
  bloomThreshold: number
}

const MOON_LIGHT = hex(0x9fb6e8)
const LIGHT_POLLUTION = hex(0xd89060)
const OVERCAST = hex(0x8a929c)

export function atmosphereAt(input: AtmosphereInput): AtmosphereState {
  const hour = wrapHour(input.hour)
  const cover = clamp01(Number.isFinite(input.cover) ? input.cover : 0)
  const rain = clamp01(Number.isFinite(input.rain) ? input.rain : 0)

  const sun = sunDirection(hour)
  const moon = moonDirection(hour)
  const sunEl = elevationDeg(sun)
  const moonEl = elevationDeg(moon)
  const k = sampleKeys(sunEl)

  const night = smoothstep(-1, -12, sunEl)
  const golden = sunEl > -4 ? 1 - smoothstep(4, 20, Math.abs(sunEl - 2)) : 0
  const practicals = smoothstep(4, -5, sunEl)

  // Cloud cover flattens and cools the light rather than just dimming it.
  const overcast = clamp01(cover * (0.55 + rain * 0.45))
  const heavy = clamp01((cover - 0.5) / 0.5) * 0.6 + rain * 0.4

  // Key light: sun above the horizon, moon once the sun is well down. Both are
  // near zero across the handover, so switching direction never pops.
  const sunI = k.sunI * (1 - overcast * 0.82)
  const moonUp = smoothstep(-2, 12, moonEl)
  const moonI = 0.35 * night * moonUp * (1 - overcast * 0.85)
  const useSun = sunEl > -3
  const keyDir = useSun ? sun : moonUp > 0 ? moon : { x: 0.3, y: 0.9, z: 0.3 }
  const keyColor = useSun ? mixRgb(k.sunColor, hex(0xc8d4e2), overcast * 0.7) : MOON_LIGHT
  const keyIntensity = useSun ? sunI : moonI

  const grey = scaleRgb(OVERCAST, lerp(1, 0.02, night) * lerp(1, 0.75, rain))
  const zenith = scaleRgb(mixRgb(k.zenith, scaleRgb(grey, 0.8), heavy), k.sky)
  const horizon = scaleRgb(mixRgb(k.horizon, grey, heavy), k.sky)
  const lpBase = lerp(0.0, 0.035, night) * (1 + cover * 1.4) * (1 + rain * 0.4)
  const lightPollution = scaleRgb(LIGHT_POLLUTION, lpBase)
  // At night the street-level haze is lit from below by the city itself.
  const cityGlow = scaleRgb(LIGHT_POLLUTION, lpBase * 0.7)
  const hazeSun = addRgb(mixRgb(k.hazeSun, grey, heavy * 0.9), cityGlow)
  const hazeAway = addRgb(mixRgb(k.hazeAway, grey, heavy * 0.9), cityGlow)

  // The sun disk is hot enough to bloom; it reddens and dims into the horizon.
  const diskFade = smoothstep(-1.2, 1.5, sunEl) * (1 - clamp01(cover * 1.1 - 0.05))
  const sunDiskIntensity = 60 * diskFade * lerp(0.35, 1, smoothstep(0, 12, sunEl))
  const mieColor = scaleRgb(k.sunColor, lerp(0.9, 0.25, overcast) * smoothstep(-8, 2, sunEl))

  // Street-level haze. Night keeps a light mist so sodium lamps have something
  // to glow through; rain closes the view down hard.
  const fogDensity = (0.00004 + overcast * 0.00005 + rain * 0.0003) * lerp(1, 1.2, night)
  const heightFogDensity = 0.00022 + golden * 0.00016 + night * 0.00012 + rain * 0.0016
  const heightFogFalloff = 1 / lerp(260, 140, rain)
  const fogFar = lerp(24000, 5200, rain) * lerp(1, 0.8, overcast)

  // Clouds: lit tops take the sun colour, bases take the sky. At night the
  // undersides pick up the city's sodium glow.
  const sunLitCloud = mixRgb(hex(0xffffff), k.sunColor, 0.45 + golden * 0.35)
  const cloudLit = mixRgb(
    scaleRgb(sunLitCloud, lerp(1.25, 0.9, overcast) * (1 - night) * smoothstep(-6, 4, sunEl) + 0.02),
    scaleRgb(LIGHT_POLLUTION, 0.05 + cover * 0.05),
    night,
  )
  const cloudShade = mixRgb(
    scaleRgb(mixRgb(k.zenith, k.horizon, 0.5), lerp(0.85, 0.6, overcast)),
    scaleRgb(LIGHT_POLLUTION, 0.022 + cover * 0.03),
    night,
  )

  // GTA-style night: the dark is blue and readable, not black. This fill is
  // baked into the environment's upper hemisphere only (the visible sky stays
  // dark), so silhouettes separate from the sky and shade stays cool.
  const nightAmbient = scaleRgb(hex(0x2a3c66), 0.06 * night * lerp(1, 0.7, overcast))

  const envIntensity = k.envI * lerp(1, 1.12, overcast)
  const exposure = k.exposure * lerp(1, 1.1, overcast * (1 - night))

  return {
    hour,
    sun,
    sunElevation: sunEl,
    moon,
    moonElevation: moonEl,
    night,
    golden,
    practicals,
    keyDir,
    keyColor,
    keyIntensity,
    hemiSky: mixRgb(k.zenith, k.horizon, 0.4),
    hemiGround: hex(0x2c2824),
    hemiIntensity: lerp(0.18, 0.1, night),
    fillIntensity: 0,
    zenith,
    horizon,
    sunDiskColor: mixRgb(k.sunColor, hex(0xffffff), smoothstep(5, 40, sunEl) * 0.6),
    sunDiskIntensity,
    mieColor,
    moonColor: hex(0xdfe6f2),
    moonIntensity: smoothstep(-3, 5, moonEl) * lerp(0.15, 1, night) * (1 - clamp01(cover * 1.1 - 0.1)),
    stars: night * (1 - clamp01(cover * 1.3)) * (1 - rain),
    lightPollution,
    nightAmbient,
    hazeSun,
    hazeAway,
    fogDensity,
    heightFogDensity,
    heightFogFalloff,
    fogFar,
    cover,
    rain,
    cloudLit,
    cloudShade,
    envIntensity,
    exposure,
    bloomIntensity: lerp(0.28, 0.9, practicals),
    bloomThreshold: lerp(1.0, 0.72, practicals),
  }
}
