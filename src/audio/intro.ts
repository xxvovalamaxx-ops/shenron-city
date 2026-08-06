/**
 * Cinematic intro soundscape, synthesised entirely at runtime.
 *
 * A single user-gesture-safe API: call `introAudio.play()` from the Enter
 * click handler. It layers a rising noise whoosh, a deep sub impact, and a
 * swelling city ambience that settles into the game's own procedural beds.
 */
interface IntroNodes {
  ctx: AudioContext
  master: GainNode
}

let nodes: IntroNodes | null = null

function ensure(ctx: AudioContext): void {
  if (nodes?.ctx === ctx) return
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  nodes = { ctx, master }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** Rising filtered-noise whoosh, ~1.4 s. */
function whoosh(ctx: AudioContext, t0: number): void {
  const buffer = noiseBuffer(ctx, 2)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.4
  filter.frequency.setValueAtTime(180, t0)
  filter.frequency.exponentialRampToValueAtTime(3600, t0 + 1.5)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.55, t0 + 0.9)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.7)
  src.connect(filter).connect(gain).connect(nodes!.master)
  src.start(t0)
  src.stop(t0 + 1.8)
}

/** Deep sub impact with a long tail, the "you are here" boom. */
function boom(ctx: AudioContext, t0: number): void {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(96, t0)
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 1.6)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.85, t0 + 0.06)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6)
  osc.connect(gain).connect(nodes!.master)
  osc.start(t0)
  osc.stop(t0 + 2.7)
  // Soft metallic shimmer on top of the impact.
  const shimmer = ctx.createOscillator()
  shimmer.type = 'triangle'
  shimmer.frequency.setValueAtTime(620, t0)
  shimmer.frequency.exponentialRampToValueAtTime(180, t0 + 1.2)
  const sg = ctx.createGain()
  sg.gain.setValueAtTime(0.0001, t0)
  sg.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05)
  sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3)
  shimmer.connect(sg).connect(nodes!.master)
  shimmer.start(t0)
  shimmer.stop(t0 + 1.4)
}

/** Slow city ambience swell — distant traffic rumble that stays in the mix. */
function citySwell(ctx: AudioContext, t0: number): void {
  const buffer = noiseBuffer(ctx, 5)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  const low = ctx.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(160, t0)
  low.frequency.linearRampToValueAtTime(520, t0 + 4)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.16, t0 + 4.2)
  gain.gain.setValueAtTime(0.16, t0 + 7)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 12)
  src.connect(low).connect(gain).connect(nodes!.master)
  src.start(t0)
  src.stop(t0 + 12)
}

export const introAudio = {
  /** Must be called from a user gesture. Safe to call repeatedly. */
  play(): void {
    const ctx = nodes?.ctx ?? new AudioContext()
    ensure(ctx)
    void ctx.resume()
    const t0 = ctx.currentTime + 0.03
    whoosh(ctx, t0)
    boom(ctx, t0 + 0.55)
    citySwell(ctx, t0 + 0.2)
  },
}
