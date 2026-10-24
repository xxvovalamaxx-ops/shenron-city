/**
 * Rotor sound for the police helicopter: filtered noise chopped by a blade-rate
 * amplitude LFO (the "wop-wop"), plus a low turbine whine, panned and faded by
 * distance. Built once on the city mix's AudioContext; silence is gain.
 *
 * A helicopter carries much further than a car, so it uses its own wide
 * fall-off instead of `placeSource`'s 90 m street radius.
 */
import { cityAudio } from './engine'
import type { ListenerPose } from './mix'

/** Heard out to here, metres. */
export const HELI_HEARING = 520
const LEVEL = 0.16
const BLADE_HZ = 17

/** Gain and pan for a helicopter at `pos`. Pure, for tests. */
export function heliPlacement(pos: { x: number; y: number; z: number }, listener: ListenerPose): { gain: number; pan: number } {
  const dx = pos.x - listener.pos.x
  const dy = pos.y - listener.pos.y
  const dz = pos.z - listener.pos.z
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (d >= HELI_HEARING) return { gain: 0, pan: 0 }
  const near = 40 / (40 + Math.max(0, d - 40))
  const taper = Math.min(1, (HELI_HEARING - d) / (HELI_HEARING * 0.3))
  const flen = Math.hypot(listener.forward.x, listener.forward.z) || 1
  const rx = -listener.forward.z / flen
  const rz = listener.forward.x / flen
  const h = Math.hypot(dx, dz)
  const side = h < 1e-3 ? 0 : (dx * rx + dz * rz) / h
  // Overhead it is all around you; off to one side it pans, but never hard.
  const spread = (h / (h + Math.abs(dy) + 1)) * 0.8
  return { gain: near * taper, pan: Math.max(-1, Math.min(1, side * spread)) }
}

interface Graph {
  ctx: AudioContext
  out: GainNode
  pan: StereoPannerNode
}

export interface HeliAudio {
  update(pos: { x: number; y: number; z: number } | null, listener: ListenerPose | null): void
  stop(): void
}

function createHeliAudio(): HeliAudio {
  let graph: Graph | null = null

  function ensure(): Graph | null {
    if (graph) return graph
    const output = cityAudio.output()
    if (!output) return null
    const ctx = output.ctx
    const pan = ctx.createStereoPanner()
    pan.connect(output.destination)
    const out = ctx.createGain()
    out.gain.value = 0
    out.connect(pan)

    // Rotor: two seconds of looped white noise, low-passed, chopped at blade rate.
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let seed = 0x2f6b
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      data[i] = (seed / 0x3fffffff - 1) * 0.9
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const body = ctx.createBiquadFilter()
    body.type = 'lowpass'
    body.frequency.value = 420
    body.Q.value = 0.7
    const chop = ctx.createGain()
    chop.gain.value = 0.55
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = BLADE_HZ
    const depth = ctx.createGain()
    depth.gain.value = 0.45
    lfo.connect(depth).connect(chop.gain)
    noise.connect(body).connect(chop).connect(out)

    // Turbine whine, quiet.
    const whine = ctx.createOscillator()
    whine.type = 'triangle'
    whine.frequency.value = 1180
    const whineGain = ctx.createGain()
    whineGain.gain.value = 0.035
    whine.connect(whineGain).connect(out)

    noise.start()
    lfo.start()
    whine.start()
    graph = { ctx, out, pan }
    return graph
  }

  return {
    update(pos, listener) {
      if (!pos || !listener) {
        if (graph) graph.out.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.4)
        return
      }
      const g = ensure()
      if (!g || !cityAudio.isEnabled()) return
      const now = g.ctx.currentTime
      const p = heliPlacement(pos, listener)
      g.out.gain.setTargetAtTime(p.gain * LEVEL, now, 0.25)
      g.pan.pan.setTargetAtTime(p.pan, now, 0.2)
    },
    stop() {
      if (graph) graph.out.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.1)
    },
  }
}

export const heliAudio: HeliAudio = createHeliAudio()
