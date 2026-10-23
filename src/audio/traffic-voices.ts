/**
 * Which nearby cars get an engine voice, and what each voice plays.
 *
 * Pure and tested; `traffic-audio.ts` turns the result into Web Audio. A
 * fixed pool of voices is shared by the nearest cars: a car keeps its voice
 * while it stays in the nearest set, so a voice never jumps from one car to
 * another mid-note unless a closer car really takes its place.
 */
import { placeSource, type ListenerPose } from './mix'

export interface TrafficSoundSource {
  /** Stable per car. Traffic and session cars use separate prefixes. */
  key: string
  x: number
  y: number
  z: number
  /** m/s, signed. */
  speed: number
  kind: string
  /** Running lights and siren (a pursuing cruiser). */
  siren: boolean
}

export interface TrafficVoiceTarget {
  key: string | null
  /** 0..1 before the voice's own level. */
  gain: number
  pan: number
  /** 0 idle … 1 near the top of a gear. */
  rpm: number
  /** Engine pitch scale for the car's kind. */
  pitch: number
  siren: boolean
}

export const TRAFFIC_VOICE_COUNT = 4
/** Past this a car is not worth a voice. Inside the session's 48 m query. */
export const TRAFFIC_HEARING_RADIUS = 45

const GEAR_SPAN = 6.5 // m/s per gear before the shift
const TOP_GEAR = 4

/** A rough gearbox for a car we only know the speed of. */
export function trafficRpm(speed: number): number {
  const s = Math.abs(speed)
  if (s < 0.4) return 0.06
  const gear = Math.min(TOP_GEAR, Math.floor(s / GEAR_SPAN))
  const within = gear === TOP_GEAR ? Math.min(1, (s - TOP_GEAR * GEAR_SPAN) / (GEAR_SPAN * 2)) : (s - gear * GEAR_SPAN) / GEAR_SPAN
  return 0.16 + 0.62 * within
}

export function kindPitch(kind: string): number {
  if (kind === 'van' || kind === 'suv' || kind === 'bus' || kind === 'truck') return 0.8
  if (kind === 'coupe' || kind === 'police') return 1.12
  return 1
}

const SILENT: TrafficVoiceTarget = { key: null, gain: 0, pan: 0, rpm: 0, pitch: 1, siren: false }

/**
 * Assign the pool to the nearest audible cars.
 *
 * `previous` is the key each voice held last frame; a car that is still in
 * the nearest set keeps its slot, and the free slots go to the newcomers.
 */
export function assignTrafficVoices(
  sources: readonly TrafficSoundSource[],
  listener: ListenerPose,
  previous: readonly (string | null)[],
  count = TRAFFIC_VOICE_COUNT,
): TrafficVoiceTarget[] {
  const scored: { src: TrafficSoundSource; d2: number }[] = []
  const r2 = TRAFFIC_HEARING_RADIUS * TRAFFIC_HEARING_RADIUS
  for (const src of sources) {
    const dx = src.x - listener.pos.x
    const dz = src.z - listener.pos.z
    const d2 = dx * dx + dz * dz
    if (d2 <= r2) scored.push({ src, d2 })
  }
  // A siren outranks a quiet car at the same distance: it is what you listen for.
  scored.sort((a, b) => (a.d2 * (a.src.siren ? 0.25 : 1)) - (b.d2 * (b.src.siren ? 0.25 : 1)))
  const chosen = scored.slice(0, count).map((s) => s.src)
  const byKey = new Map(chosen.map((s) => [s.key, s]))

  const slots: (TrafficSoundSource | null)[] = new Array(count).fill(null)
  const placed = new Set<string>()
  for (let i = 0; i < count; i++) {
    const key = previous[i] ?? null
    const src = key !== null ? byKey.get(key) : undefined
    if (src) {
      slots[i] = src
      placed.add(src.key)
    }
  }
  let next = 0
  for (const src of chosen) {
    if (placed.has(src.key)) continue
    while (next < count && slots[next] !== null) next++
    if (next >= count) break
    slots[next] = src
    placed.add(src.key)
  }

  return slots.map((src) => {
    if (!src) return SILENT
    const place = placeSource({ x: src.x, y: src.y, z: src.z }, listener)
    return {
      key: src.key,
      gain: place.gain,
      pan: place.pan,
      rpm: trafficRpm(src.speed),
      pitch: kindPitch(src.kind),
      siren: src.siren,
    }
  })
}
