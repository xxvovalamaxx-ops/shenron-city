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
  ENGINE_BUS_LEVEL,
  engineVoice,
  type AudioEvent,
  type EngineState,
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
  /** Every node owned by this bed, for deterministic teardown. */
  nodes: AudioNode[]
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
  /** Every node owned by this motor, for deterministic teardown. */
  nodes: AudioNode[]
}

/**
 * The car's engine.
 *
 * Two detuned sawtooths an octave apart through one lowpass. Detuning is what
 * stops it sounding like a test tone: two oscillators a few cents apart beat
 * against each other, which is most of what a real engine's roughness is.
 *
 * `place` and `level` are separate for the same reason the motor's are — one is
 * ramped by distance every frame, the other by whether there is a car at all,
 * and a single gain would have them fighting.
 */
interface EngineBus {
  level: GainNode
  place: GainNode
  pan: StereoPannerNode
  low: OscillatorNode
  high: OscillatorNode
  filter: BiquadFilterNode
  sources: AudioScheduledSourceNode[]
  /** Every node owned by this engine, for deterministic teardown. */
  nodes: AudioNode[]
}

interface Graph {
  ctx: AudioContext
  master: GainNode
  limiter: DynamicsCompressorNode
  leftAnalyser: AnalyserNode
  rightAnalyser: AnalyserNode
  bedTone: BiquadFilterNode
  shotBus: GainNode
  send: GainNode
  wetTone: BiquadFilterNode
  noise: AudioBuffer
  beds: Record<ZoneId, BedChain>
  motor: Motor
  engine: EngineBus
  /** Every node created for this graph, excluding the context destination. */
  nodes: AudioNode[]
}

export interface CityAudio {
  /**
   * Create and resume the context. Must be called from a user gesture; safe to
   * call again at any time.
   */
  start(): Promise<void>
  /** Advance the mix. Call once a frame with `rt.player` and the frame delta. */
  update(player: PlayerPose, dt: number): void
  /**
   * Trigger a world event. `at` is a world position; omit for non-positional.
   *
   * `delay` schedules the voice that many seconds ahead on the audio clock,
   * which is how a two-part action gets its second half: entering a car is a
   * door opening and then, half a second later, shutting. Scheduling it on the
   * audio clock rather than with a timer keeps the gap exact regardless of what
   * the frame rate is doing.
   */
  play(event: AudioEvent, at?: Vec3, delay?: number): void
  /**
   * Set the engine note, or silence it.
   *
   * `null` means there is no car under the listener — on foot, or before one is
   * entered — and ramps the bus down rather than leaving a tone running. `at`
   * is the car's world position; omit it while the player is driving, so the
   * note is heard from inside rather than panned around their own head.
   */
  setEngine(state: EngineState | null, at?: Vec3): void
  /** Suspends the context outright rather than muting a running graph. */
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
  /** 0 to 1, on a perceptual taper. */
  setMasterVolume(volume: number): void
  getMasterVolume(): number
  /** Current browser-audio evidence without exposing mutable graph nodes. */
  diagnostics(): {
    state: AudioContextState | 'uninitialized'
    sampleRate: number
    currentTime: number
    leftRms: number
    rightRms: number
    stereoDifference: number
    /**
     * What the engine bus is actually doing.
     *
     * Exposed because master RMS cannot answer "is the engine audible" — the
     * zone beds sit under everything, and a first measurement showed full
     * throttle reading *lower* than idle, which is the bed moving and the
     * engine contributing nothing. A gate needs the bus's own numbers.
     *
     * `placeGain` is here and not folded into `level` because the two are
     * separate nodes in series and either one alone is a lie: a healthy
     * `level` behind a `placeGain` stuck at 0.05 is an engine nobody can hear.
     * That was a real bug, and `level` on its own could not see it.
     */
    engine: {
      level: number
      placeGain: number
      pan: number
      hz: number
      cutoffHz: number
      on: boolean
    }
  }
  /** Tear down the current graph. A later `start()` builds a fresh one. */
  dispose(): void
}

export function createCityAudio(): CityAudio {
  let graph: Graph | null = null
  let enabled = true
  let volume = 0.7
  let footsteps: FootstepState = initialFootsteps()
  let motorRunning = false
  let motorAt: Vec3 | null = null
  let engineAt: Vec3 | null = null
  let engineOn = false
  let lastPos: Vec3 | null = null
  let listener: ListenerPose = initialListener()

  function ensureGraph(): Graph | null {
    if (graph) return graph
    // Node, and any browser old enough to lack Web Audio, simply get no sound.
    if (typeof AudioContext === 'undefined') return null
    graph = buildGraph(new AudioContext({ latencyHint: 'interactive' }), volume)
    return graph
  }

  function placeEngine(now: number): void {
    if (!graph) return
    const place = engineAt ? placeSource(engineAt, listener) : { gain: 1, pan: 0 }
    graph.engine.place.gain.setTargetAtTime(place.gain, now, PLACEMENT_SMOOTHING)
    graph.engine.pan.pan.setTargetAtTime(place.pan, now, PLACEMENT_SMOOTHING)
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

  /**
   * Follow the simulation's speed and throttle with the engine bus.
   *
   * Smoothed with setTargetAtTime rather than written directly: the sim runs on
   * a fixed substep and the frame rate does not, so raw values produce a
   * stepped note. The constants are short — 60 ms on pitch — because an engine
   * that lags the throttle sounds like a recording rather than a car.
   */
  function setEngine(state: EngineState | null, at?: Vec3): void {
    // Cleared, not kept, when no position is given. `if (at)` left the last AI
    // car's position standing, so the moment the player got into a car their
    // own engine was still being placed at whatever they had last walked past.
    // A car 55 m back leaves `place.gain` near 0.05: the note the driver is
    // sitting inside plays at a twentieth of its level, panned to one side, and
    // stays there for the whole drive because nothing ever re-places it.
    engineAt = at ? { x: at.x, y: at.y, z: at.z } : null
    if (!graph) {
      engineOn = state !== null
      return
    }
    const { ctx, engine } = graph
    const now = ctx.currentTime

    // A positionless engine belongs to the listener. Apply that immediately,
    // rather than waiting for the next frame, so entering the player car cannot
    // spend a frame (or a paused frame) attenuated and panned at the last AI car.
    placeEngine(now)

    if (!state) {
      if (engineOn) {
        engineOn = false
        engine.level.gain.cancelScheduledValues(now)
        engine.level.gain.setTargetAtTime(0, now, 0.12)
      }
      return
    }
    engineOn = true

    const voice = engineVoice(state)
    engine.low.frequency.setTargetAtTime(voice.hz, now, 0.06)
    engine.high.frequency.setTargetAtTime(voice.hz * 2, now, 0.06)
    engine.filter.frequency.setTargetAtTime(voice.cutoffHz, now, 0.09)
    engine.level.gain.setTargetAtTime(voice.gain * ENGINE_BUS_LEVEL, now, 0.05)
  }

  return {
    setEngine,
    async start() {
      const g = ensureGraph()
      if (!g) return
      enabled = true
      if (g.ctx.state !== 'running') {
        try {
          await g.ctx.resume()
        } catch (error) {
          // React StrictMode can clean up this graph between `resume()` and its
          // promise settling. That graph no longer belongs to this instance, so
          // its close rejection is expected rather than a failed start.
          if (graph !== g || g.ctx.state === 'closed') return
          throw error
        }
      }
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

      // ── Engine and motor, re-placed as the player moves ───────────────────
      if (engineOn) placeEngine(now)
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

    play(event, at, delay = 0) {
      if (!graph || !enabled) return
      const where = at ?? listener.pos
      switch (event) {
        case 'doorOpen':
          triggerShot(ONE_SHOTS.doorOpen, where, delay, 1, 1)
          return
        case 'doorClose':
          triggerShot(ONE_SHOTS.doorClose, where, delay, 1, 1)
          return
        case 'carDoorOpen':
          triggerShot(ONE_SHOTS.carDoorOpen, where, delay, 1, 1)
          return
        case 'carDoorClose':
          triggerShot(ONE_SHOTS.carDoorClose, where, delay, 1, 1)
          return
        case 'elevatorArrive':
          triggerShot(ONE_SHOTS.elevatorArrive, where, delay, 1, 1)
          return
        case 'footstep': {
          const voice = footstepVoice()
          triggerShot(ONE_SHOTS.footstep, where, delay, voice.pitch, voice.gain)
          return
        }
        case 'elevatorStart':
          rampMotor(true, at)
          return
        case 'elevatorStop':
          rampMotor(false, at)
          return
        case 'horn':
          triggerShot(ONE_SHOTS.horn, where, delay, 1, 1)
          return
      }
      // Exhaustiveness, and it is not decoration: `horn` was in `AudioEvent`,
      // had a voice in `ONE_SHOTS`, and was fired by GameLoop on the jump key
      // while driving — and this switch had no case for it, so pressing the
      // horn did nothing at all. A switch over a union in a void function is
      // legal without a default, so nothing complained: not tsc, not eslint,
      // not a test. `never` makes the next event that gets added fail to
      // compile rather than fail to sound.
      return assertHandled(event)
    },

    setEnabled(next) {
      enabled = next
      if (!graph) return
      // Suspending stops the audio thread. Zeroing the master would leave sixty
      // oscillators and ten noise voices running for nothing.
      if (next) void graph.ctx.resume().catch(() => undefined)
      else void graph.ctx.suspend().catch(() => undefined)
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

    diagnostics() {
      if (!graph) {
        return {
          state: 'uninitialized',
          sampleRate: 0,
          currentTime: 0,
          leftRms: 0,
          rightRms: 0,
          stereoDifference: 0,
          engine: { level: 0, placeGain: 0, pan: 0, hz: 0, cutoffHz: 0, on: engineOn },
        }
      }
      const left = new Float32Array(graph.leftAnalyser.fftSize)
      const right = new Float32Array(graph.rightAnalyser.fftSize)
      graph.leftAnalyser.getFloatTimeDomainData(left)
      graph.rightAnalyser.getFloatTimeDomainData(right)
      let leftPower = 0
      let rightPower = 0
      let differencePower = 0
      for (let index = 0; index < left.length; index += 1) {
        leftPower += left[index] * left[index]
        rightPower += right[index] * right[index]
        const difference = left[index] - right[index]
        differencePower += difference * difference
      }
      return {
        engine: {
          level: graph.engine.level.gain.value,
          placeGain: graph.engine.place.gain.value,
          pan: graph.engine.pan.pan.value,
          hz: graph.engine.low.frequency.value,
          cutoffHz: graph.engine.filter.frequency.value,
          on: engineOn,
        },
        state: graph.ctx.state,
        sampleRate: graph.ctx.sampleRate,
        currentTime: graph.ctx.currentTime,
        leftRms: Math.sqrt(leftPower / left.length),
        rightRms: Math.sqrt(rightPower / right.length),
        stereoDifference: Math.sqrt(differencePower / left.length),
      }
    },

    dispose() {
      // Clear public state even when there was no graph. This makes a cleanup
      // after a failed/later StrictMode mount harmless and prevents a fresh
      // graph from inheriting an engine that belonged to the old one.
      const previous = graph
      graph = null
      motorRunning = false
      motorAt = null
      engineAt = null
      engineOn = false
      lastPos = null
      footsteps = initialFootsteps()
      listener = initialListener()
      if (!previous) return

      stopSources(previous)
      disconnectGraph(previous)
      // Closing releases the AudioContext's internal resources. A StrictMode
      // cleanup can race an in-flight resume, so a context that has already
      // become closed is deliberately not surfaced as an unhandled rejection.
      try {
        void previous.ctx.close().catch(() => undefined)
      } catch {
        // Some implementations can throw synchronously for an already-closed
        // context. All graph-owned sources and nodes were already detached.
      }
    },
  }
}

function initialListener(): ListenerPose {
  return { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } }
}

function stopSources(graph: Graph): void {
  const sources = [
    ...ZONE_IDS.flatMap((id) => graph.beds[id].sources),
    ...graph.motor.sources,
    ...graph.engine.sources,
  ]
  for (const source of new Set(sources)) {
    try {
      source.stop()
    } catch {
      // A source may already have ended or been stopped by its envelope. Its
      // output is still detached below, which is all teardown needs from it.
    }
  }
}

function disconnectGraph(graph: Graph): void {
  for (const node of new Set(graph.nodes)) {
    try {
      node.disconnect()
    } catch {
      // Web Audio permits a node to be detached more than once in practice, but
      // implementations differ on whether an already-disconnected output
      // throws. Cleanup must remain idempotent either way.
    }
  }
}

/** A pre-built, non-owning handle. There is one city, so there is one mix. */
export const cityAudio = createCityAudio()

// Exposed for the QA harnesses, alongside __cityWorld / __rt / __simulation /
// __hud / __vehicleSim. `scripts/qa/enginecheck.mjs` reaches the mix through a
// dynamic import of this module otherwise, which quietly depends on the dev
// server handing back the same instance the app imported — a probe that
// constructs its own second graph measures a graph nobody can hear.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __cityAudio: CityAudio }).__cityAudio = cityAudio
}

/**
 * Reached only if a member of {@link AudioEvent} has no case above.
 *
 * Typed `never`, so that is a compile error rather than a silent no-op. At
 * runtime it does nothing: a mix that throws mid-frame because somebody added
 * an event is worse than one that misses a sound.
 */
function assertHandled(event: never): void {
  void event
}

// ── Graph construction ───────────────────────────────────────────────────────

function buildGraph(ctx: AudioContext, volume: number): Graph {
  const noise = makeNoise(ctx, NOISE_SECONDS)

  const master = ctx.createGain()
  master.gain.value = masterGain(volume)
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
  master.connect(limiter).connect(ctx.destination)

  const splitter = ctx.createChannelSplitter(2)
  const leftAnalyser = ctx.createAnalyser()
  const rightAnalyser = ctx.createAnalyser()
  leftAnalyser.fftSize = 2048
  rightAnalyser.fftSize = 2048
  const silentTap = ctx.createGain()
  silentTap.gain.value = 0
  limiter.connect(splitter)
  splitter.connect(leftAnalyser, 0)
  splitter.connect(rightAnalyser, 1)
  leftAnalyser.connect(silentTap)
  rightAnalyser.connect(silentTap)
  silentTap.connect(ctx.destination)

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
  const motor = buildMotor(ctx, noise, shotBus)
  const engine = buildEngineBus(ctx, shotBus)

  return {
    ctx,
    master,
    limiter,
    leftAnalyser,
    rightAnalyser,
    bedTone,
    shotBus,
    send,
    wetTone,
    noise,
    beds,
    motor,
    engine,
    nodes: [
      master,
      limiter,
      splitter,
      leftAnalyser,
      rightAnalyser,
      silentTap,
      bedTone,
      bedBus,
      shotBus,
      send,
      convolver,
      wetTone,
      ...ZONE_IDS.flatMap((id) => beds[id].nodes),
      ...motor.nodes,
      ...engine.nodes,
    ],
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
  const nodes: AudioNode[] = [gain]

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
      nodes.push(src, filter, level)

      if (voice.driftHz > 0) {
        // A bed that never moves stops being heard as a place after a minute.
        const lfo = ctx.createOscillator()
        lfo.frequency.value = voice.driftRate
        const depth = ctx.createGain()
        depth.gain.value = voice.driftHz
        lfo.connect(depth).connect(filter.frequency)
        lfo.start()
        sources.push(lfo)
        nodes.push(lfo, depth)
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
    nodes.push(level)
    for (const hz of [voice.hz, voice.hz + voice.beatHz]) {
      const osc = ctx.createOscillator()
      osc.type = voice.wave
      osc.frequency.value = hz
      osc.connect(level)
      osc.start()
      sources.push(osc)
      nodes.push(osc)
    }
  }

  return { gain, sources, nodes }
}

function buildEngineBus(ctx: AudioContext, destination: AudioNode): EngineBus {
  const place = ctx.createGain()
  place.gain.value = 1
  const pan = ctx.createStereoPanner()
  const level = ctx.createGain()
  // Silent until a car exists. An engine audible from the title screen is a
  // more memorable bug than a silent one.
  level.gain.value = 0

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400
  filter.Q.value = 0.9

  const low = ctx.createOscillator()
  low.type = 'sawtooth'
  low.frequency.value = 40
  const high = ctx.createOscillator()
  high.type = 'sawtooth'
  high.frequency.value = 80
  // A few cents apart, so the two beat rather than lock. Exact octaves sound
  // synthetic; this is where the roughness comes from.
  high.detune.value = 7

  const mix = ctx.createGain()
  mix.gain.value = 0.5
  low.connect(mix)
  high.connect(mix)
  mix.connect(filter).connect(level).connect(pan).connect(place).connect(destination)

  low.start()
  high.start()
  return {
    level,
    place,
    pan,
    low,
    high,
    filter,
    sources: [low, high],
    nodes: [place, pan, level, filter, low, high, mix],
  }
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

  return {
    level,
    place,
    pan,
    osc,
    noiseFilter,
    sources: [osc, src],
    nodes: [place, pan, level, osc, toneGain, src, noiseFilter, noiseGain],
  }
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
