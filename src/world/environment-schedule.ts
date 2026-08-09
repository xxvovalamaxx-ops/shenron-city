/**
 * Which environment map lights the city, at what strength, at a given hour.
 *
 * The city used to have image-based lighting only at night. There was one HDR
 * in the build — a night one — and `NightEnvironment` correctly faded it to
 * nothing across dawn so it would not light a noon scene. The consequence was
 * that from about 07:00 to 17:00 `scene.environment` contributed zero: glass,
 * car paint and every metal surface had nothing to reflect but the analytic
 * sun, which is most of why the daytime city read flat.
 *
 * Four maps now cover the clock. Kept pure and separate from the component so
 * the curve can be tested without a WebGL context, the same way
 * `environmentIntensityFor` was.
 *
 * Attribution — all four are CC0 from Poly Haven, recorded with their download
 * receipts in SourceAssets/PublicLibrary/SOURCES.md:
 *   kiara_1_dawn, urban_street_03, german_town_street  (Greg Zaal, Poly Haven)
 *   modern_buildings_night                             (Greg Zaal, Poly Haven)
 */

export type EnvironmentMapId = 'night' | 'dawn' | 'day' | 'evening'

export const ENVIRONMENT_MAPS: Record<EnvironmentMapId, string> = {
  night: '/hdr/modern_buildings_night_1k.hdr',
  dawn: '/hdr/kiara_1_dawn_1k.hdr',
  day: '/hdr/urban_street_03_1k.hdr',
  evening: '/hdr/german_town_street_1k.hdr',
}

export const ENVIRONMENT_MAP_IDS = Object.keys(ENVIRONMENT_MAPS) as EnvironmentMapId[]

/**
 * Keyframes around the clock: at this hour, this map, at this intensity.
 *
 * Intensity is not uniform because the maps are not equally bright. A daytime
 * street HDR carries far more energy than a night one, so matching numbers
 * would blow the daytime city out. Night keeps the 0.2 the previous
 * implementation used, which is the one value here with a track record.
 *
 * Must stay sorted by hour, and must span 0..24 so every hour interpolates
 * between two entries rather than falling off an end.
 */
interface Keyframe {
  hour: number
  map: EnvironmentMapId
  intensity: number
}

const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, map: 'night', intensity: 0.2 },
  { hour: 4.5, map: 'night', intensity: 0.2 },
  { hour: 6.5, map: 'dawn', intensity: 0.45 },
  { hour: 9, map: 'day', intensity: 0.7 },
  { hour: 15, map: 'day', intensity: 0.7 },
  { hour: 18, map: 'evening', intensity: 0.5 },
  { hour: 20, map: 'dawn', intensity: 0.3 },
  { hour: 21.5, map: 'night', intensity: 0.2 },
  { hour: 24, map: 'night', intensity: 0.2 },
]

export interface EnvironmentBlend {
  /** The map being faded out of, and the one being faded into. */
  from: EnvironmentMapId
  to: EnvironmentMapId
  /** 0 = entirely `from`, 1 = entirely `to`. */
  blend: number
  /** What to set `scene.environmentIntensity` to. */
  intensity: number
}

/**
 * The environment at an hour.
 *
 * Returns a pair and a weight rather than a single map because switching
 * outright between a dawn HDR and a midday one is a visible pop across every
 * reflective surface at once. The caller mixes the two equirectangular maps
 * before generating the PMREM, so the transition is continuous.
 *
 * `from === to` in the middle of a long stable stretch, which lets the caller
 * skip the blend pass entirely rather than mixing a map with itself.
 */
export function environmentForHour(hour: number): EnvironmentBlend {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 0

  let previous = KEYFRAMES[0]
  for (const frame of KEYFRAMES) {
    if (frame.hour > h) {
      const span = frame.hour - previous.hour
      // Guard against a duplicated hour in the table: a zero span would divide
      // by zero and put NaN into every reflective material in the scene.
      const t = span <= 0 ? 0 : (h - previous.hour) / span
      return {
        from: previous.map,
        to: frame.map,
        blend: previous.map === frame.map ? 0 : t,
        intensity: previous.intensity + (frame.intensity - previous.intensity) * t,
      }
    }
    previous = frame
  }

  // Past the last keyframe, which spans hour 24 and so is only reachable
  // exactly at 24 — but `h` is already wrapped, so this is the 0 case.
  return { from: previous.map, to: previous.map, blend: 0, intensity: previous.intensity }
}

/**
 * How much the environment has changed between two blends.
 *
 * The caller regenerates a PMREM when this crosses a threshold. Mixing and
 * pre-filtering a 1K equirect map costs a few milliseconds, which is nothing
 * once in a while and unacceptable every frame.
 */
export function environmentDelta(a: EnvironmentBlend, b: EnvironmentBlend): number {
  if (a.from !== b.from || a.to !== b.to) return Infinity
  return Math.abs(a.blend - b.blend)
}
