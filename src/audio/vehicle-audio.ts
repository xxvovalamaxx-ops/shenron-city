/**
 * Procedural vehicle audio: engine, tyres, horn, siren and impacts.
 *
 * No files. Everything is oscillators, one generated noise buffer, a
 * waveshaper and filters, built lazily on the city mix's AudioContext and
 * routed into its master bus — so the game's volume, the limiter and
 * `cityAudio.setEnabled` (which suspends the whole context) all apply. The
 * graph is about twenty nodes, built once and kept running; silence is gain,
 * not teardown, so starting and stopping the engine never clicks.
 *
 * The engine note is a firing-frequency sawtooth stack (idle rumble to
 * redline howl) through a soft clipper and a load-dependent low-pass, with a
 * sub-harmonic amplitude wobble for a lumpy idle and a band of intake noise.
 * The rev figure comes from the gearbox (gameplay/vehicles/vehicle-gearbox),
 * so up- and down-shifts are heard as the revs swing, plus a brief dip in
 * load on each change.
 */
import { cityAudio } from './engine'

export interface VehicleAudioFrame {
  /** The player is in a car: the engine runs. */
  active: boolean
  /** 0 idle … 1 redline. */
  rpmNorm: number
  /** 0..1. */
  throttle: number
  /** m/s, unsigned. */
  speed: number
  /** 0..1 how hard the tyres slide. */
  slip: number
  horn: boolean
  shiftedUp: boolean
  shiftedDown: boolean
  kind: string
  siren: boolean
}

interface EngineVoice {
  saw: OscillatorNode
  sub: OscillatorNode
  harm: OscillatorNode
  wobble: OscillatorNode
  wobbleDepth: GainNode
  tone: BiquadFilterNode
  level: GainNode
  intake: BiquadFilterNode
  intakeLevel: GainNode
}

interface Graph {
  ctx: AudioContext
  out: GainNode
  noise: AudioBuffer
  engine: EngineVoice
  squeal: { level: GainNode; tone: OscillatorNode; band: BiquadFilterNode }
  horn: { level: GainNode }
  siren: { level: GainNode; osc: OscillatorNode }
  sources: AudioScheduledSourceNode[]
}

/** Firing frequency range, Hz (4-stroke four at idle … a six near the redline). */
const IDLE_HZ = 27
const REDLINE_HZ = 235
const SMOOTH = 0.04

function makeNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let b = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    b = b * 0.6 + white * 0.4
    data[i] = b
  }
  return buffer
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

function build(ctx: AudioContext, destination: AudioNode): Graph {
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(destination)
  const noise = makeNoise(ctx)
  const sources: AudioScheduledSourceNode[] = []

  // ── Engine ────────────────────────────────────────────────────────────────
  const level = ctx.createGain()
  level.gain.value = 0
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 400
  tone.Q.value = 1.1
  const shaper = ctx.createWaveShaper()
  shaper.curve = softClip(2.4)
  shaper.oversample = '2x'
  const mix = ctx.createGain()
  mix.gain.value = 0.5
  mix.connect(shaper).connect(tone).connect(level).connect(out)

  const saw = ctx.createOscillator()
  saw.type = 'sawtooth'
  saw.frequency.value = IDLE_HZ
  const sawGain = ctx.createGain()
  sawGain.gain.value = 0.7
  saw.connect(sawGain).connect(mix)

  const sub = ctx.createOscillator()
  sub.type = 'square'
  sub.frequency.value = IDLE_HZ / 2
  const subGain = ctx.createGain()
  subGain.gain.value = 0.35
  sub.connect(subGain).connect(mix)

  const harm = ctx.createOscillator()
  harm.type = 'sawtooth'
  harm.frequency.value = IDLE_HZ * 2.01
  const harmGain = ctx.createGain()
  harmGain.gain.value = 0.22
  harm.connect(harmGain).connect(mix)

  // lumpy idle: amplitude wobble at half the firing rate
  const wobble = ctx.createOscillator()
  wobble.type = 'sine'
  wobble.frequency.value = IDLE_HZ / 2
  const wobbleDepth = ctx.createGain()
  wobbleDepth.gain.value = 0.25
  wobble.connect(wobbleDepth).connect(mix.gain)

  // intake / exhaust rasp
  const intakeSrc = ctx.createBufferSource()
  intakeSrc.buffer = noise
  intakeSrc.loop = true
  const intake = ctx.createBiquadFilter()
  intake.type = 'bandpass'
  intake.frequency.value = 500
  intake.Q.value = 0.9
  const intakeLevel = ctx.createGain()
  intakeLevel.gain.value = 0
  intakeSrc.connect(intake).connect(intakeLevel).connect(out)

  // ── Tyre squeal ──────────────────────────────────────────────────────────
  const squealLevel = ctx.createGain()
  squealLevel.gain.value = 0
  squealLevel.connect(out)
  const squealNoise = ctx.createBufferSource()
  squealNoise.buffer = noise
  squealNoise.loop = true
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2300
  band.Q.value = 6
  const bandGain = ctx.createGain()
  bandGain.gain.value = 1.6
  squealNoise.connect(band).connect(bandGain).connect(squealLevel)
  const squealTone = ctx.createOscillator()
  squealTone.type = 'triangle'
  squealTone.frequency.value = 1150
  const vib = ctx.createOscillator()
  vib.frequency.value = 7.3
  const vibDepth = ctx.createGain()
  vibDepth.gain.value = 55
  vib.connect(vibDepth).connect(squealTone.frequency)
  const squealToneGain = ctx.createGain()
  squealToneGain.gain.value = 0.18
  squealTone.connect(squealToneGain).connect(squealLevel)

  // ── Horn: two detuned squares, a classic G/B major third ────────────────
  const hornLevel = ctx.createGain()
  hornLevel.gain.value = 0
  const hornTone = ctx.createBiquadFilter()
  hornTone.type = 'lowpass'
  hornTone.frequency.value = 1900
  hornTone.connect(hornLevel).connect(out)
  const hornA = ctx.createOscillator()
  hornA.type = 'square'
  hornA.frequency.value = 392
  const hornB = ctx.createOscillator()
  hornB.type = 'square'
  hornB.frequency.value = 494
  const hornMix = ctx.createGain()
  hornMix.gain.value = 0.5
  hornA.connect(hornMix)
  hornB.connect(hornMix)
  hornMix.connect(hornTone)

  // ── Siren: a slow wail ───────────────────────────────────────────────────
  const sirenLevel = ctx.createGain()
  sirenLevel.gain.value = 0
  sirenLevel.connect(out)
  const sirenOsc = ctx.createOscillator()
  sirenOsc.type = 'sawtooth'
  sirenOsc.frequency.value = 900
  const sirenLfo = ctx.createOscillator()
  sirenLfo.type = 'triangle'
  sirenLfo.frequency.value = 0.28
  const sirenDepth = ctx.createGain()
  sirenDepth.gain.value = 380
  sirenLfo.connect(sirenDepth).connect(sirenOsc.frequency)
  const sirenTone = ctx.createBiquadFilter()
  sirenTone.type = 'lowpass'
  sirenTone.frequency.value = 2400
  sirenOsc.connect(sirenTone).connect(sirenLevel)

  for (const src of [saw, sub, harm, wobble, intakeSrc, squealNoise, squealTone, vib, hornA, hornB, sirenOsc, sirenLfo]) {
    if (src instanceof AudioBufferSourceNode) src.start(0, Math.random() * noise.duration)
    else src.start()
    sources.push(src)
  }

  return {
    ctx,
    out,
    noise,
    engine: { saw, sub, harm, wobble, wobbleDepth, tone, level, intake, intakeLevel },
    squeal: { level: squealLevel, tone: squealTone, band },
    horn: { level: hornLevel },
    siren: { level: sirenLevel, osc: sirenOsc },
    sources,
  }
}

export interface VehicleAudio {
  update(frame: VehicleAudioFrame, dt: number): void
  /** A crash, 0..1. */
  impact(strength: number): void
  stop(): void
}

function createVehicleAudio(): VehicleAudio {
  let graph: Graph | null = null
  let shiftDip = 0
  let lastImpact = 0

  function ensure(): Graph | null {
    if (graph) return graph
    const output = cityAudio.output()
    if (!output) return null
    graph = build(output.ctx, output.destination)
    return graph
  }

  return {
    update(frame, dt) {
      const g = ensure()
      if (!g || !cityAudio.isEnabled()) return
      const now = g.ctx.currentTime
      const e = g.engine
      if (frame.shiftedUp || frame.shiftedDown) shiftDip = frame.shiftedUp ? 0.14 : 0.09
      shiftDip = Math.max(0, shiftDip - dt)
      const heavy = frame.kind === 'van' || frame.kind === 'suv'
      const sporty = frame.kind === 'coupe' || frame.kind === 'police'
      const baseHz = heavy ? 0.85 : sporty ? 1.12 : 1
      const hz = (IDLE_HZ + (REDLINE_HZ - IDLE_HZ) * frame.rpmNorm) * baseHz
      e.saw.frequency.setTargetAtTime(hz, now, SMOOTH)
      e.sub.frequency.setTargetAtTime(hz / 2, now, SMOOTH)
      e.harm.frequency.setTargetAtTime(hz * 2.01, now, SMOOTH)
      e.wobble.frequency.setTargetAtTime(hz / 2, now, SMOOTH)
      // wobble fades as the revs rise (idle lope → smooth)
      e.wobbleDepth.gain.setTargetAtTime(0.28 * (1 - frame.rpmNorm), now, 0.1)
      const load = shiftDip > 0 ? 0.25 : frame.throttle
      e.tone.frequency.setTargetAtTime(260 + 900 * frame.rpmNorm + 1900 * load * (0.4 + frame.rpmNorm), now, SMOOTH)
      const engineLevel = frame.active ? (0.075 + 0.1 * frame.rpmNorm + 0.11 * load) * (sporty ? 1.15 : 1) : 0
      e.level.gain.setTargetAtTime(engineLevel, now, frame.active ? 0.05 : 0.35)
      e.intake.frequency.setTargetAtTime(420 + 1800 * frame.rpmNorm, now, SMOOTH)
      e.intakeLevel.gain.setTargetAtTime(frame.active ? 0.05 * load * (0.3 + frame.rpmNorm) : 0, now, 0.06)

      const slip = frame.active ? Math.min(1, frame.slip) : 0
      g.squeal.level.gain.setTargetAtTime(slip > 0.05 ? 0.035 + 0.1 * slip : 0, now, 0.05)
      g.squeal.band.frequency.setTargetAtTime(1900 + 900 * slip + Math.min(600, frame.speed * 12), now, 0.08)

      g.horn.level.gain.setTargetAtTime(frame.horn ? 0.09 : 0, now, 0.012)
      g.siren.level.gain.setTargetAtTime(frame.siren ? 0.028 : 0, now, 0.2)
    },

    impact(strength) {
      const g = ensure()
      if (!g || !cityAudio.isEnabled()) return
      const now = g.ctx.currentTime
      // at most one thump every 120 ms
      if (now - lastImpact < 0.12) return
      lastImpact = now
      const peak = 0.08 + 0.32 * Math.max(0, Math.min(1, strength))
      const thump = g.ctx.createOscillator()
      thump.type = 'sine'
      thump.frequency.setValueAtTime(110, now)
      thump.frequency.exponentialRampToValueAtTime(38, now + 0.3)
      const thumpGain = g.ctx.createGain()
      thumpGain.gain.setValueAtTime(0.0001, now)
      thumpGain.gain.linearRampToValueAtTime(peak, now + 0.008)
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
      thump.connect(thumpGain).connect(g.out)
      const crunch = g.ctx.createBufferSource()
      crunch.buffer = g.noise
      const crunchTone = g.ctx.createBiquadFilter()
      crunchTone.type = 'lowpass'
      crunchTone.frequency.setValueAtTime(3200, now)
      crunchTone.frequency.exponentialRampToValueAtTime(400, now + 0.25)
      const crunchGain = g.ctx.createGain()
      crunchGain.gain.setValueAtTime(0.0001, now)
      crunchGain.gain.linearRampToValueAtTime(peak * 0.8, now + 0.004)
      crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
      crunch.connect(crunchTone).connect(crunchGain).connect(g.out)
      thump.start(now)
      crunch.start(now, Math.random() * g.noise.duration * 0.5)
      thump.stop(now + 0.45)
      crunch.stop(now + 0.32)
      thump.onended = () => {
        thumpGain.disconnect()
        crunchGain.disconnect()
      }
    },

    stop() {
      if (!graph) return
      const now = graph.ctx.currentTime
      graph.engine.level.gain.setTargetAtTime(0, now, 0.05)
      graph.squeal.level.gain.setTargetAtTime(0, now, 0.05)
      graph.horn.level.gain.setTargetAtTime(0, now, 0.02)
      graph.siren.level.gain.setTargetAtTime(0, now, 0.05)
    },
  }
}

/** The one vehicle voice (the player's car). */
export const vehicleAudio: VehicleAudio = createVehicleAudio()
