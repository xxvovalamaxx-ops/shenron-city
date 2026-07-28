/**
 * The only file in the game that touches Web Audio.
 *
 * It is deliberately mechanical: every number that decides how something sounds
 * lives in `mix.ts`, which is pure and tested. What is left here is graph
 * construction, envelope scheduling, and the lifecycle rules the browser
 * imposes — which is exactly the part that cannot be unit tested anyway.
 *
 * Nothing is downloaded. Noise is generated into an AudioBuffer at runtime, the
 * reverb impulse is synthesised from decaying noise, and every voice is an
 * oscillator or that buffer through a filter. The game ships no audio assets
 * and `npm run verify:standalone` would fail if it tried to reach a host.
 *
 * No AudioContext is constructed at module scope. Browsers refuse to start one
 * outside a user gesture, and a context created on import is born suspended and
 * never recovers cleanly; `start()` must be called from a click handler.
 */
import {
  BED_BUS_LEVEL,
  BED_VOICES,
  MOTOR,
  ONE_SHOTS,
  SILENCE,
  ZONE_IDS,
  advanceFootsteps,
  blendRoom,
  footstepVoice,
  initialFootsteps,
  masterGain,
  placeSource,
  zoneGains,
  zoneWeights,
  type AudioEvent,
  type BedVoice,
  type FootstepState,
  type ListenerPose,
  type OneShotSpec,
  type PlayerPose,
  type ZoneId,
} from './mix'
import type { Vec3 } from '../gameplay/collision'

/** Seconds of noise generated once and shared by every noise voice. */
const NOISE_SECONDS = 6
/** Reverb tail. Long enough to read as a lobby, short enough to stay cheap. */
const IMPULSE_SECONDS = 1.9
const IMPULSE_DECAY = 3.2

/** Smoothing constants for `setTargetAtTime`, in seconds. */
const BED_SMOOTHING = 0.35
const PLACEMENT_SMOOTHING = 0.08
const VOLUME_SMOOTHING = 0.05

/** Below this a one-shot is inaudible and not worth allocating nodes for. */
const AUDIBLE = 0.0005

interface BedChain {
  gain: GainNode
  sources: AudioScheduledSourceNode[]
}

interface Motor {
  /** Ramped by the start/stop events. */
  level: GainNode
  /** Ramped by distance, every frame. Separate so the two never fight. */
  place: GainNode
  pan: StereoPannerNode
  osc: OscillatorNode
  noiseFilter: BiquadFilterNode
  sources: AudioScheduledSourceNode[]
}

interface Graph {
  ctx: AudioContext
  master: GainNode
  bedTone: BiquadFilterNode
  shotBus: GainNode
  send: GainNode
  wetTone: BiquadFilterNode
  noise: AudioBuffer
  beds: Record<ZoneId, BedChain>
  motor: Motor
}

export interface CityAudio {
  /**
   * Create and resume the context. Must be called from a user gesture; safe to
   * call again at any time.
   */
  start(): Promise<void>
  /** Advance the mix. Call once a frame with `rt.player` and the frame delta. */
  update(player: PlayerPose, dt: number): void
  /** Trigger a world event. `at` is a world position; omit for non-positional. */
  play(event: AudioEvent, at?: Vec3): void
  /** Suspends the context outright rather than muting a running graph. */
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  /** 0 to 1, on a perceptual taper. */
  setMasterVolume(volume: number): void
  getMasterVolume(): number
  /** Tear the whole thing down. The instance is unusable afterwards. */
  dispose(): void
}

export function createCityAudio(): CityAudio {
  let graph: Graph | null = null
  let enabled = true
  let volume = 0.7
  let footsteps: FootstepState = initialFootsteps()
  let motorRunning = false
  let motorAt: Vec3 | null = null
  let lastPos: Vec3 | null = null
  let listener: ListenerPose = { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } }

  function ensureGraph(): Graph | null {
    if (graph) return graph
    // Node, and any browser old enough to lack Web Audio, simply get no sound.
    if (typeof AudioContext === 'undefined') return null
    graph = buildGraph(new AudioContext({ latencyHint: 'interactive' }), volume)
    return graph
  }

  function triggerShot(spec: OneShotSpec, at: Vec3, delay: number, pitch: number, level: number) {
    if (!graph) return
    const place = placeSource(at, listener)
    const peak = spec.level * level * place.gain
    if (peak < AUDIBLE) return

    const { ctx } = graph
    const t0 = ctx.currentTime + delay
    const end = t0 + spec.duration

    const out = ctx.createGain()
    out.gain.value = Math.min(1, peak)
    const pan = ctx.createStereoPanner()
    pan.pan.value = place.pan
    out.connect(pan).connect(graph.shotBus)

    const sources: AudioScheduledSourceNode[] = []

    if (spec.noise) {
      const src = ctx.createBufferSource()
      src.buffer = graph.noise
      src.loop = true
      const filter = ctx.createBiquadFilter()
      filter.type = spec.noise.filter
      filter.Q.value = spec.noise.q
      filter.frequency.setValueAtTime(spec.noise.fromHz * pitch, t0)
      filter.frequency.linearRampToValueAtTime(spec.noise.toHz * pitch, end)
      const level_ = ctx.createGain()
      envelope(level_.gain, t0, spec.noise.level, spec.attack, spec.duration)
      src.connect(filter).connect(level_).connect(out)
      src.start(t0, Math.random() * graph.noise.duration)
      sources.push(src)
    }

    if (spec.tone) {
      const osc = ctx.createOscillator()
      osc.type = spec.tone.wave
      osc.frequency.setValueAtTime(spec.tone.fromHz * pitch, t0)
      osc.frequency.linearRampToValueAtTime(spec.tone.toHz * pitch, end)
      const level_ = ctx.createGain()
      envelope(level_.gain, t0, spec.tone.level, spec.attack, spec.duration)
      osc.connect(level_).connect(out)
      osc.start(t0)
      sources.push(osc)
    }

    for (const partial of spec.partials) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = partial.hz * pitch
      const level_ = ctx.createGain()
      envelope(level_.gain, t0 + partial.delay, partial.level, spec.attack, partial.decay)
      osc.connect(level_).connect(out)
      osc.start(t0 + partial.delay)
      sources.push(osc)
    }

    // Every layer stops together — the specs guarantee each one is silent by
    // then — so one `onended` can drop the whole voice. Without this a minute of
    // footsteps leaves several hundred dead nodes hanging off the bus.
    for (const source of sources) source.stop(end)
    const first = sources[0]
    if (first) {
      first.onended = () => {
        out.disconnect()
        pan.disconnect()
      }
    }
  }

  function rampMotor(running: boolean, at?: Vec3) {
    if (!graph) return
    if (at) motorAt = { x: at.x, y: at.y, z: at.z }
    // Re-announcing a running motor only moves the source. Restarting the ramp
    // would re-spool the machine every frame if the caller tracks the car.
    if (running === motorRunning) return
    motorRunning = running

    const { ctx, motor } = graph
    const now = ctx.currentTime
    const ramp = running ? MOTOR.rampUp : MOTOR.rampDown

    motor.level.gain.cancelScheduledValues(now)
    motor.level.gain.setTargetAtTime(running ? MOTOR.level : 0, now, ramp / 3)

    motor.osc.frequency.cancelScheduledValues(now)
    motor.osc.frequency.setValueAtTime(motor.osc.frequency.value, now)
    motor.osc.frequency.linearRampToValueAtTime(running ? MOTOR.runHz : MOTOR.idleHz, now + ramp)

    motor.noiseFilter.frequency.cancelScheduledValues(now)
    motor.noiseFilter.frequency.setValueAtTime(motor.noiseFilter.frequency.value, now)
    motor.noiseFilter.frequency.linearRampToValueAtTime(
      running ? MOTOR.noiseRunHz : MOTOR.noiseIdleHz,
      now + ramp,
    )

    if (!running) {
      triggerShot(ONE_SHOTS.elevatorSettle, motorAt ?? listener.pos, MOTOR.rampDown, 1, 1)
    }
  }

  return {
    async start() {
      const g = ensureGraph()
      if (!g) return
      enabled = true
      if (g.ctx.state !== 'running') await g.ctx.resume()
    },

    update(player, dt) {
      if (!graph || !enabled || dt <= 0) return
      const { ctx } = graph
      const now = ctx.currentTime

      listener = { pos: player.pos, forward: player.forward }

      // ── Ambience crossfade ────────────────────────────────────────────────
      const weights = zoneWeights(player.pos)
      const gains = zoneGains(weights)
      for (const id of ZONE_IDS) {
        graph.beds[id].gain.gain.setTargetAtTime(gains[id], now, BED_SMOOTHING)
      }

      const room = blendRoom(weights)
      graph.send.gain.setTargetAtTime(room.reverbSend, now, BED_SMOOTHING)
      graph.bedTone.frequency.setTargetAtTime(room.bedCutoffHz, now, BED_SMOOTHING)
      graph.wetTone.frequency.setTargetAtTime(room.wetCutoffHz, now, BED_SMOOTHING)

      // ── Motor, re-placed as the player moves relative to the shaft ────────
      if (motorAt) {
        const place = placeSource(motorAt, listener)
        graph.motor.place.gain.setTargetAtTime(place.gain, now, PLACEMENT_SMOOTHING)
        graph.motor.pan.pan.setTargetAtTime(place.pan, now, PLACEMENT_SMOOTHING)
      }

      // ── Footsteps ─────────────────────────────────────────────────────────
      // Speed is derived rather than asked for: the caller already moved the
      // player, and a second source of truth would drift from what was drawn.
      let speed = 0
      if (lastPos) {
        speed = Math.hypot(player.pos.x - lastPos.x, player.pos.z - lastPos.z) / dt
      }
      lastPos = { x: player.pos.x, y: player.pos.y, z: player.pos.z }

      const stepped = advanceFootsteps(footsteps, speed, dt, player.grounded)
      footsteps = stepped.state
      if (stepped.fired) {
        const voice = footstepVoice()
        triggerShot(ONE_SHOTS.footstep, player.pos, 0, voice.pitch, voice.gain)
      }
    },

    play(event, at) {
      if (!graph || !enabled) return
      const where = at ?? listener.pos
      switch (event) {
        case 'doorOpen':
          triggerShot(ONE_SHOTS.doorOpen, where, 0, 1, 1)
          return
        case 'doorClose':
          triggerShot(ONE_SHOTS.doorClose, where, 0, 1, 1)
          return
        case 'elevatorArrive':
          triggerShot(ONE_SHOTS.elevatorArrive, where, 0, 1, 1)
          return
        case 'footstep': {
          const voice = footstepVoice()
          triggerShot(ONE_SHOTS.footstep, where, 0, voice.pitch, voice.gain)
          return
        }
        case 'elevatorStart':
          rampMotor(true, at)
          return
        case 'elevatorStop':
          rampMotor(false, at)
          return
      }
    },

    setEnabled(next) {
      enabled = next
      if (!graph) return
      // Suspending stops the audio thread. Zeroing the master would leave sixty
      // oscillators and ten noise voices running for nothing.
      if (next) void graph.ctx.resume()
      else void graph.ctx.suspend()
    },

    isEnabled() {
      return enabled
    },

    setMasterVolume(next) {
      volume = next < 0 ? 0 : next > 1 ? 1 : next
      if (!graph) return
      graph.master.gain.setTargetAtTime(
        masterGain(volume),
        graph.ctx.currentTime,
        VOLUME_SMOOTHING,
      )
    },

    getMasterVolume() {
      return volume
    },

    dispose() {
      if (!graph) return
      for (const id of ZONE_IDS) {
        for (const source of graph.beds[id].sources) source.stop()
      }
      for (const source of graph.motor.sources) source.stop()
      void graph.ctx.close()
      graph = null
      motorRunning = false
      motorAt = null
      lastPos = null
      footsteps = initialFootsteps()
    },
  }
}

/** A pre-built, non-owning handle. There is one city, so there is one mix. */
export const cityAudio = createCityAudio()

// ── Graph construction ───────────────────────────────────────────────────────

function buildGraph(ctx: AudioContext, volume: number): Graph {
  const noise = makeNoise(ctx, NOISE_SECONDS)

  const master = ctx.createGain()
  master.gain.value = masterGain(volume)
  master.connect(ctx.destination)

  // Beds run through their own tone control so walking indoors muffles the
  // street continuously, rather than swapping one bed for another at a line.
  const bedTone = ctx.createBiquadFilter()
  bedTone.type = 'lowpass'
  bedTone.frequency.value = 18000
  bedTone.Q.value = 0.4
  bedTone.connect(master)

  const bedBus = ctx.createGain()
  bedBus.gain.value = BED_BUS_LEVEL
  bedBus.connect(bedTone)

  // One-shots go dry to the master and, in parallel, through the room. The send
  // level is what makes the lobby a lobby.
  const shotBus = ctx.createGain()
  shotBus.gain.value = 1
  shotBus.connect(master)

  const send = ctx.createGain()
  send.gain.value = 0.05
  shotBus.connect(send)

  const convolver = ctx.createConvolver()
  convolver.buffer = makeImpulse(ctx, IMPULSE_SECONDS, IMPULSE_DECAY)
  send.connect(convolver)

  const wetTone = ctx.createBiquadFilter()
  wetTone.type = 'lowpass'
  wetTone.frequency.value = 5200
  wetTone.Q.value = 0.5
  convolver.connect(wetTone).connect(master)

  const beds: Record<ZoneId, BedChain> = {
    boulevard: buildBed(ctx, noise, BED_VOICES.boulevard, bedBus),
    market: buildBed(ctx, noise, BED_VOICES.market, bedBus),
    park: buildBed(ctx, noise, BED_VOICES.park, bedBus),
    lobby: buildBed(ctx, noise, BED_VOICES.lobby, bedBus),
    hq: buildBed(ctx, noise, BED_VOICES.hq, bedBus),
  }

  return {
    ctx,
    master,
    bedTone,
    shotBus,
    send,
    wetTone,
    noise,
    beds,
    motor: buildMotor(ctx, noise, shotBus),
  }
}

function buildBed(
  ctx: AudioContext,
  noise: AudioBuffer,
  voices: readonly BedVoice[],
  destination: AudioNode,
): BedChain {
  const gain = ctx.createGain()
  // Silent until the first `update` places the listener; otherwise every bed in
  // the city would speak at once on the frame the context resumes.
  gain.gain.value = 0
  gain.connect(destination)

  const sources: AudioScheduledSourceNode[] = []

  for (const voice of voices) {
    if (voice.kind === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = noise
      src.loop = true

      const filter = ctx.createBiquadFilter()
      filter.type = voice.filter
      filter.frequency.value = voice.hz
      filter.Q.value = voice.q

      const level = ctx.createGain()
      level.gain.value = voice.gain
      src.connect(filter).connect(level).connect(gain)

      if (voice.driftHz > 0) {
        // A bed that never moves stops being heard as a place after a minute.
        const lfo = ctx.createOscillator()
        lfo.frequency.value = voice.driftRate
        const depth = ctx.createGain()
        depth.gain.value = voice.driftHz
        lfo.connect(depth).connect(filter.frequency)
        lfo.start()
        sources.push(lfo)
      }

      // A random offset per voice, so two beds sharing the buffer do not phase
      // lock into an audible pattern.
      src.start(0, Math.random() * noise.duration)
      sources.push(src)
      continue
    }

    const level = ctx.createGain()
    level.gain.value = voice.gain / 2
    level.connect(gain)
    for (const hz of [voice.hz, voice.hz + voice.beatHz]) {
      const osc = ctx.createOscillator()
      osc.type = voice.wave
      osc.frequency.value = hz
      osc.connect(level)
      osc.start()
      sources.push(osc)
    }
  }

  return { gain, sources }
}

function buildMotor(ctx: AudioContext, noise: AudioBuffer, destination: AudioNode): Motor {
  const place = ctx.createGain()
  place.gain.value = 1
  const pan = ctx.createStereoPanner()
  place.connect(pan).connect(destination)

  const level = ctx.createGain()
  level.gain.value = 0
  level.connect(place)

  const osc = ctx.createOscillator()
  osc.type = MOTOR.wave
  osc.frequency.value = MOTOR.idleHz
  const toneGain = ctx.createGain()
  toneGain.gain.value = MOTOR.level
  osc.connect(toneGain).connect(level)
  osc.start()

  const src = ctx.createBufferSource()
  src.buffer = noise
  src.loop = true
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'lowpass'
  noiseFilter.frequency.value = MOTOR.noiseIdleHz
  noiseFilter.Q.value = MOTOR.noiseQ
  const noiseGain = ctx.createGain()
  noiseGain.gain.value = MOTOR.noiseLevel
  src.connect(noiseFilter).connect(noiseGain).connect(level)
  src.start(0, Math.random() * noise.duration)

  return { level, place, pan, osc, noiseFilter, sources: [osc, src] }
}

// ── Synthesis ────────────────────────────────────────────────────────────────

/**
 * Pink-ish noise, generated once and shared.
 *
 * White noise is too bright to pass for traffic, wind or a crowd at any filter
 * setting. True pink needs a filter bank; three one-poles at spread cutoffs sit
 * within about a decibel across the band that matters here and cost three
 * multiplies a sample. The two channels are generated independently so the
 * stereo image has width before anything is panned.
 */
function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    let slow = 0
    let mid = 0
    let fast = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      slow = slow * 0.99 + white * 0.01
      mid = mid * 0.92 + white * 0.08
      fast = fast * 0.62 + white * 0.38
      const v = (slow * 3.2 + mid * 1.1 + fast * 0.5) * 0.35
      data[i] = v < -1 ? -1 : v > 1 ? 1 : v
    }
  }

  return buffer
}

/**
 * Reverb impulse: decaying noise with a short build.
 *
 * A tail that starts at full amplitude on sample zero reads as a gunshot rather
 * than a room, so the first few milliseconds ramp in. One impulse serves the
 * whole game; the lobby and floor 45 are told apart by send level and by the
 * tone control on the return, which are both continuous and can therefore be
 * crossfaded as the player walks.
 */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const t = i / length
      const build = Math.min(1, t / 0.02)
      data[i] = (Math.random() * 2 - 1) * build * Math.pow(1 - t, decay)
    }
  }

  return buffer
}

/**
 * Attack to `peak`, then an exponential fall to silence at `t0 + duration`.
 *
 * Exponential ramps cannot reach or start from zero, hence the `SILENCE` floor
 * at both ends; a linear fall instead sounds like a fade rather than a decay.
 */
function envelope(
  param: AudioParam,
  t0: number,
  peak: number,
  attack: number,
  duration: number,
): void {
  const top = Math.max(peak, SILENCE)
  param.cancelScheduledValues(t0)
  param.setValueAtTime(SILENCE, t0)
  param.linearRampToValueAtTime(top, t0 + attack)
  param.exponentialRampToValueAtTime(SILENCE, t0 + duration)
}
