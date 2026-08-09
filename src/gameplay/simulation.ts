/**
 * The one ordered simulation authority.
 *
 * The game advances from eleven independent `useFrame` callbacks. Order today
 * comes from R3F render priorities, and it is *correct*: GameLoop sits at -100
 * so it writes `rt.paused` and the runtime clock before anything reads them,
 * and IntroSequence sits at 150 so it renders last. That was worth checking
 * before rewriting it, and it is worth writing down, because the first version
 * of this comment claimed a read-before-write bug that does not exist.
 *
 * What is actually wrong is subtler and survives being correct today:
 *
 *   - The order is expressed as bare integers in separate files. Nine of the
 *     eleven callbacks are at the default priority 0, so their relative order
 *     is mount order in the JSX. Nothing declares that, nothing tests it, and
 *     moving a line in App.tsx can reorder the simulation without any
 *     diagnostic. The correctness is real but accidental.
 *   - The step was clamped in six independent places, all spelling 1/20 by
 *     hand: `MAX_DT` in GameLoop, and a bare `Math.min(rawDt, 1 / 20)` in
 *     ManhattanCity, PlayerBody, CityLightingRig, DayCycleRig and the
 *     since-removed SkyRig. Six copies that agree today are six copies that
 *     can disagree tomorrow, silently, with parts of the world running at
 *     different speeds. They now all read MAX_STEP_SECONDS from here.
 *   - The vehicle registry and the LION traffic registry advance separately,
 *     so a city car cannot become the player's car without a second
 *     overlapping instance of it existing. That is the one with player-visible
 *     consequences, and it is why this module exists rather than a lint rule.
 *
 * So the fix is not to reorder anything. It is to stop the order being an
 * emergent property of priorities and mount order. Systems register with a
 * declared stage; the authority runs the stages in a fixed order with one
 * delta and one pause decision, and rendering consumes what it finds.
 *
 * This module is deliberately free of React and Three so the ordering and
 * pause contracts can be tested as arithmetic.
 */

/**
 * Stages run in this order, every frame, regardless of registration order.
 *
 * `input` reads devices and decides pause. `clock` advances simulation time —
 * after input, so a pause taken this frame stops this frame's time. `vehicles`
 * and `city` are the two halves of the world, vehicles first because the city
 * reads the player's position to stream toward it. `presentation` is for
 * systems that only look at state: cameras, rigs, HUD sampling.
 */
export const SIM_STAGES = ['input', 'clock', 'vehicles', 'city', 'presentation'] as const

export type SimStage = (typeof SIM_STAGES)[number]

/**
 * The stages that advance the world. Run by {@link Simulation.step}.
 */
export const GAMEPLAY_STAGES = ['input', 'clock', 'vehicles', 'city'] as const

/**
 * The stage that only reads. Run by {@link Simulation.present}, separately and
 * later.
 *
 * Split out because the first version ran all five stages from one call inside
 * GameLoop's `useFrame`, which sits at render priority -100 — so `presentation`
 * ran *before* every callback at the default priority 0, the exact opposite of
 * what the name promises. That is not a nitpick: IntroSequence is at priority
 * 150 specifically so its camera dive survives DragLook writing the camera at
 * 0, and moving it into a stage that runs at -100 would have let DragLook
 * overwrite the intro camera every frame. The stage list would have caused a
 * visible regression while looking like a tidy-up.
 *
 * So presentation is a second call, made from a high-priority callback after
 * everything else has moved. Same frame, same dt, same pause decision — a
 * presentation system reading a different delta from the gameplay it is
 * presenting would be its own bug.
 */
export const PRESENTATION_STAGE = 'presentation' as const

/** The largest step the simulation will take, in seconds. */
export const MAX_STEP_SECONDS = 1 / 20

export interface SimFrame {
  /** Clamped seconds since the previous frame. Always 0 in a paused frame. */
  dt: number
  /** Unclamped seconds, for presentation systems that want real time. */
  rawDt: number
  /** True when this frame advanced no gameplay state. */
  paused: boolean
  /** Monotonic frame counter, for anything that wants to stride work. */
  frame: number
}

export type SimStep = (frame: SimFrame) => void

interface Registration {
  id: string
  stage: SimStage
  step: SimStep
}

export interface SimulationStats {
  frame: number
  /** Systems registered, by stage. */
  systems: Record<SimStage, string[]>
  /** Ids that threw on the most recent frame. */
  failed: string[]
}

export class Simulation {
  private readonly byStage = new Map<SimStage, Registration[]>()
  private frameCount = 0
  private lastFailed: string[] = []
  /** The frame `step` last ran, so `present` can reuse it exactly. */
  private lastFrame: SimFrame | null = null
  /** Set by the input stage; every other stage reads it. */
  private pausedFlag = false

  constructor() {
    for (const stage of SIM_STAGES) this.byStage.set(stage, [])
  }

  /**
   * Add or replace a system.
   *
   * Registering an id that already exists replaces it in place rather than
   * appending. React strict mode and hot reload both mount effects twice, and
   * an append would step the city twice per frame — which looks exactly like
   * the world running at double speed and nothing else.
   */
  register(id: string, stage: SimStage, step: SimStep): () => void {
    const list = this.byStage.get(stage)
    if (!list) throw new Error(`simulation: unknown stage "${stage}"`)
    // An id may not sit in two stages at once; drop any previous placement.
    this.unregister(id)
    list.push({ id, stage, step })
    return () => this.unregister(id)
  }

  unregister(id: string): boolean {
    for (const list of this.byStage.values()) {
      const i = list.findIndex((r) => r.id === id)
      if (i >= 0) {
        list.splice(i, 1)
        return true
      }
    }
    return false
  }

  /** Whether the most recent frame was paused. Written only by setPaused. */
  get paused(): boolean {
    return this.pausedFlag
  }

  /**
   * Declare the pause state for the frame about to run.
   *
   * Called by the input stage, which is why input is first: a pause decided
   * this frame must stop this frame, not the next one.
   */
  setPaused(paused: boolean): void {
    this.pausedFlag = paused
  }

  /**
   * Run the gameplay stages of one frame.
   *
   * Returns the frame that was run, so a caller can log or assert on it.
   * {@link present} runs the presentation stage against this same frame.
   */
  step(rawDt: number): SimFrame {
    this.frameCount++
    // One clamp, in one place. A non-finite or negative delta is a dropped
    // frame or a tab that just woke up; treat it as no time passing rather
    // than letting NaN reach an integrator it can never leave.
    const safeRaw = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0
    const clamped = Math.min(safeRaw, MAX_STEP_SECONDS)

    const failed: string[] = []
    // The input stage decides pause, so build the frame after running it.
    let frame: SimFrame = {
      dt: clamped,
      rawDt: safeRaw,
      paused: this.pausedFlag,
      frame: this.frameCount,
    }

    for (const stage of GAMEPLAY_STAGES) {
      if (stage === 'clock') {
        // Re-read: the input stage may have just changed it.
        frame = { ...frame, paused: this.pausedFlag }
      }
      // Pausing zeroes the delta; it does not skip stages.
      //
      // The first version skipped every gameplay stage while paused, and
      // adopting it in ManhattanCity showed why that is wrong: the city
      // pipeline must keep running with dt 0 so the tile streamers converge
      // on the loaded set behind the pause menu. Skipping it would have
      // frozen streaming whenever the player opened settings — a regression
      // the stage list itself would have caused, silently.
      //
      // So the rule is one rule: dt is 0 in a paused frame. Anything that
      // integrates by dt freezes for free. Anything that must hard-stop
      // regardless of dt reads `frame.paused` and returns.
      const staged: SimFrame = frame.paused ? { ...frame, dt: 0 } : frame
      for (const reg of this.byStage.get(stage) ?? []) {
        try {
          reg.step(staged)
        } catch (err) {
          // One broken system must not take the frame down with it. A world
          // that stops rendering is a worse bug report than one that stutters.
          failed.push(reg.id)
          console.error(`[simulation] "${reg.id}" (${stage}) threw:`, err)
        }
      }
    }

    this.lastFailed = failed
    const ran = { ...frame, dt: frame.paused ? 0 : frame.dt }
    this.lastFrame = ran
    return ran
  }

  /**
   * Run the presentation stage against the frame {@link step} last ran.
   *
   * Takes no delta on purpose. The dt is whatever the gameplay stages used, so
   * a camera rig cannot smooth against a different time step than the motion it
   * is smoothing — which is the kind of mismatch that shows up as a camera that
   * lags only when the frame rate dips.
   *
   * A no-op before the first `step`: presenting a frame that never simulated
   * would hand every rig a delta and a pause state that describe nothing.
   */
  present(): SimFrame | null {
    const frame = this.lastFrame
    if (!frame) return null
    for (const reg of this.byStage.get(PRESENTATION_STAGE) ?? []) {
      try {
        reg.step(frame)
      } catch (err) {
        this.lastFailed.push(reg.id)
        console.error(`[simulation] "${reg.id}" (${PRESENTATION_STAGE}) threw:`, err)
      }
    }
    return frame
  }

  stats(): SimulationStats {
    const systems = {} as Record<SimStage, string[]>
    for (const stage of SIM_STAGES) {
      systems[stage] = (this.byStage.get(stage) ?? []).map((r) => r.id)
    }
    return { frame: this.frameCount, systems, failed: [...this.lastFailed] }
  }

  /** Drop every registration. For tests and for a full teardown. */
  clear(): void {
    for (const list of this.byStage.values()) list.length = 0
    this.lastFailed = []
    this.lastFrame = null
  }
}

/** The game's single instance. */
export const simulation = new Simulation()

// Exposed for the QA harnesses, alongside __cityWorld / __rt /
// __manhattanCollision. Without it there is no way to ask from outside which
// systems are registered, in which stage, or whether a frame actually ran —
// which is exactly the question a "did the refactor keep working" check needs
// to answer, and answering it by proxy is how a probe ends up measuring the
// wrong loop.
if (typeof globalThis !== 'undefined') {
  ;(globalThis as unknown as { __simulation: Simulation }).__simulation = simulation
}
