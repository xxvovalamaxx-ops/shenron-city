/**
 * Engine and siren sound for the cars around the player.
 *
 * A small fixed pool of voices (see `traffic-voices.ts` for who gets one),
 * built once on the city mix's AudioContext like the player's car, so the
 * master volume, limiter and mute all apply. Each voice is a cut-down copy of
 * the player's engine (a firing-frequency sawtooth and a sub through a
 * low-pass), panned and attenuated by distance, with a siren layered on for a
 * pursuing cruiser. Silence is gain, not teardown.
 */
import { cityAudio } from './engine'
import type { ListenerPose } from './mix'
import { assignTrafficVoices, TRAFFIC_VOICE_COUNT, type TrafficSoundSource } from './traffic-voices'

const IDLE_HZ = 27
const REDLINE_HZ = 210
const SMOOTH = 0.06
/** Peak engine level of a car right beside you; well under the player's car. */
const ENGINE_LEVEL = 0.07
const SIREN_LEVEL = 0.05

interface Voice {
  saw: OscillatorNode
  sub: OscillatorNode
  tone: BiquadFilterNode
  engine: GainNode
  siren: GainNode
  sirenOsc: OscillatorNode
  pan: StereoPannerNode
  key: string | null
}

interface Graph {
  ctx: AudioContext
  voices: Voice[]
}

function buildVoice(ctx: AudioContext, out: AudioNode, index: number): Voice {
  const pan = ctx.createStereoPanner()
  pan.connect(out)

  const engine = ctx.createGain()
  engine.gain.value = 0
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 320
  tone.Q.value = 0.9
  tone.connect(engine).connect(pan)

  const saw = ctx.createOscillator()
  saw.type = 'sawtooth'
  // A little detune per voice, so two idling cars do not phase into one tone.
  saw.frequency.value = IDLE_HZ * (1 + index * 0.013)
  const sawGain = ctx.createGain()
  sawGain.gain.value = 0.6
  saw.connect(sawGain).connect(tone)

  const sub = ctx.createOscillator()
  sub.type = 'square'
  sub.frequency.value = IDLE_HZ / 2
  const subGain = ctx.createGain()
  subGain.gain.value = 0.3
  sub.connect(subGain).connect(tone)

  const siren = ctx.createGain()
  siren.gain.value = 0
  const sirenOsc = ctx.createOscillator()
  sirenOsc.type = 'sawtooth'
  sirenOsc.frequency.value = 900
  const lfo = ctx.createOscillator()
  lfo.type = 'triangle'
  // Different wail rates per voice, so two cruisers do not sound like one.
  lfo.frequency.value = 0.26 + index * 0.05
  const depth = ctx.createGain()
  depth.gain.value = 380
  lfo.connect(depth).connect(sirenOsc.frequency)
  const sirenTone = ctx.createBiquadFilter()
  sirenTone.type = 'lowpass'
  sirenTone.frequency.value = 2200
  sirenOsc.connect(sirenTone).connect(siren).connect(pan)

  for (const src of [saw, sub, sirenOsc, lfo]) src.start()
  return { saw, sub, tone, engine, siren, sirenOsc, pan, key: null }
}

export interface TrafficAudio {
  update(sources: readonly TrafficSoundSource[], listener: ListenerPose): void
  stop(): void
}

function createTrafficAudio(): TrafficAudio {
  let graph: Graph | null = null

  function ensure(): Graph | null {
    if (graph) return graph
    const output = cityAudio.output()
    if (!output) return null
    const voices: Voice[] = []
    for (let i = 0; i < TRAFFIC_VOICE_COUNT; i++) voices.push(buildVoice(output.ctx, output.destination, i))
    graph = { ctx: output.ctx, voices }
    return graph
  }

  return {
    update(sources, listener) {
      const g = ensure()
      if (!g || !cityAudio.isEnabled()) return
      const now = g.ctx.currentTime
      const targets = assignTrafficVoices(sources, listener, g.voices.map((v) => v.key))
      targets.forEach((t, i) => {
        const v = g.voices[i]
        // A voice handed to a new car fades in from its own pitch, not a glide.
        const handover = t.key !== v.key
        v.key = t.key
        const hz = (IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * t.rpm) * t.pitch * (1 + i * 0.013)
        const glide = handover ? 0.005 : SMOOTH
        v.saw.frequency.setTargetAtTime(hz, now, glide)
        v.sub.frequency.setTargetAtTime(hz / 2, now, glide)
        v.tone.frequency.setTargetAtTime(240 + 1100 * t.rpm, now, SMOOTH)
        v.engine.gain.setTargetAtTime(t.gain * ENGINE_LEVEL * (0.55 + 0.6 * t.rpm), now, handover ? 0.15 : 0.08)
        v.siren.gain.setTargetAtTime(t.siren ? t.gain * SIREN_LEVEL : 0, now, 0.2)
        v.pan.pan.setTargetAtTime(t.pan, now, 0.08)
      })
    },

    stop() {
      if (!graph) return
      const now = graph.ctx.currentTime
      for (const v of graph.voices) {
        v.engine.gain.setTargetAtTime(0, now, 0.1)
        v.siren.gain.setTargetAtTime(0, now, 0.1)
        v.key = null
      }
    },
  }
}

/** The shared pool of traffic voices. */
export const trafficAudio: TrafficAudio = createTrafficAudio()
