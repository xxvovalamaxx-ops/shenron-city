import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCityAudio } from './engine'

class FakeAudioParam {
  value = 0

  cancelScheduledValues(_at: number): void {}

  setValueAtTime(value: number, _at: number): void {
    this.value = value
  }

  setTargetAtTime(value: number, _at: number, _timeConstant: number): void {
    this.value = value
  }

  linearRampToValueAtTime(value: number, _at: number): void {
    this.value = value
  }

  exponentialRampToValueAtTime(value: number, _at: number): void {
    this.value = value
  }
}

class FakeAudioNode {
  disconnectCalls = 0

  connect<T>(destination: T): T {
    return destination
  }

  disconnect(): void {
    this.disconnectCalls += 1
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam()
}

class FakeStereoPannerNode extends FakeAudioNode {
  pan = new FakeAudioParam()
}

class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass'
  frequency = new FakeAudioParam()
  Q = new FakeAudioParam()
}

class FakeScheduledSource extends FakeAudioNode {
  startCalls = 0
  stopCalls = 0
  onended: (() => void) | null = null

  start(): void {
    this.startCalls += 1
  }

  stop(): void {
    this.stopCalls += 1
    this.onended?.()
  }
}

class FakeOscillatorNode extends FakeScheduledSource {
  type: OscillatorType = 'sine'
  frequency = new FakeAudioParam()
  detune = new FakeAudioParam()
}

class FakeBufferSourceNode extends FakeScheduledSource {
  buffer: AudioBuffer | null = null
  loop = false
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  threshold = new FakeAudioParam()
  knee = new FakeAudioParam()
  ratio = new FakeAudioParam()
  attack = new FakeAudioParam()
  release = new FakeAudioParam()
}

class FakeAnalyserNode extends FakeAudioNode {
  fftSize = 2048

  getFloatTimeDomainData(values: Float32Array): void {
    values.fill(0)
  }
}

class FakeConvolverNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null
}

class FakeAudioBuffer {
  readonly duration: number

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate
  }

  getChannelData(_channel: number): Float32Array {
    return new Float32Array(this.length)
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []

  readonly sampleRate = 128
  readonly destination = new FakeAudioNode()
  readonly nodes: FakeAudioNode[] = []
  readonly oscillators: FakeOscillatorNode[] = []
  currentTime = 0
  state: AudioContextState = 'suspended'
  closeCalls = 0

  constructor(_options?: AudioContextOptions) {
    FakeAudioContext.instances.push(this)
  }

  createGain(): GainNode {
    return this.track(new FakeGainNode()) as unknown as GainNode
  }

  createStereoPanner(): StereoPannerNode {
    return this.track(new FakeStereoPannerNode()) as unknown as StereoPannerNode
  }

  createBiquadFilter(): BiquadFilterNode {
    return this.track(new FakeBiquadFilterNode()) as unknown as BiquadFilterNode
  }

  createOscillator(): OscillatorNode {
    const oscillator = this.track(new FakeOscillatorNode())
    this.oscillators.push(oscillator)
    return oscillator as unknown as OscillatorNode
  }

  createBufferSource(): AudioBufferSourceNode {
    return this.track(new FakeBufferSourceNode()) as unknown as AudioBufferSourceNode
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return this.track(new FakeDynamicsCompressorNode()) as unknown as DynamicsCompressorNode
  }

  createChannelSplitter(_numberOfOutputs?: number): ChannelSplitterNode {
    return this.track(new FakeAudioNode()) as unknown as ChannelSplitterNode
  }

  createAnalyser(): AnalyserNode {
    return this.track(new FakeAnalyserNode()) as unknown as AnalyserNode
  }

  createConvolver(): ConvolverNode {
    return this.track(new FakeConvolverNode()) as unknown as ConvolverNode
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate) as unknown as AudioBuffer
  }

  resume(): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.state === 'closed') throw new Error('cannot resume a closed AudioContext')
      this.state = 'running'
    })
  }

  suspend(): Promise<void> {
    this.state = 'suspended'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closeCalls += 1
    this.state = 'closed'
    return Promise.resolve()
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.nodes.push(node)
    return node
  }
}

const player = {
  pos: { x: 0, y: 0, z: 0 },
  forward: { x: 0, z: -1 },
  grounded: true,
}

const driving = {
  speedMps: 16,
  throttle: 0.7,
  braking: false,
  reversing: false,
}

function latestContext(): FakeAudioContext {
  const context = FakeAudioContext.instances.at(-1)
  if (!context) throw new Error('expected AudioContext to be created')
  return context
}

describe('city audio engine lifecycle', () => {
  beforeEach(() => {
    FakeAudioContext.instances.length = 0
    vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    FakeAudioContext.instances.length = 0
  })

  it('centres and restores full engine placement as soon as a player engine has no world position', async () => {
    const audio = createCityAudio()
    await audio.start()

    audio.setEngine(driving, { x: 25, y: 0, z: 0 })
    audio.update(player, 1 / 60)
    const positional = audio.diagnostics().engine
    expect(positional.placeGain).toBeLessThan(1)
    expect(positional.pan).toBeGreaterThan(0)

    audio.setEngine(driving)

    expect(audio.diagnostics().engine).toMatchObject({
      on: true,
      placeGain: 1,
      pan: 0,
    })
  })

  it('stops and detaches every engine source, resets engine state, and is idempotent', async () => {
    const audio = createCityAudio()
    await audio.start()
    const context = latestContext()
    const engineOscillators = context.oscillators.slice(-2)
    expect(engineOscillators).toHaveLength(2)

    audio.setEngine(driving)
    audio.dispose()

    expect(engineOscillators.map((oscillator) => oscillator.stopCalls)).toEqual([1, 1])
    expect(engineOscillators.map((oscillator) => oscillator.disconnectCalls)).toEqual([1, 1])
    expect(context.nodes.every((node) => node.disconnectCalls === 1)).toBe(true)
    expect(context.closeCalls).toBe(1)
    expect(audio.diagnostics().engine).toEqual({
      level: 0,
      placeGain: 0,
      pan: 0,
      hz: 0,
      cutoffHz: 0,
      on: false,
    })

    expect(() => audio.dispose()).not.toThrow()
    expect(engineOscillators.map((oscillator) => oscillator.stopCalls)).toEqual([1, 1])
    expect(context.closeCalls).toBe(1)
  })

  it('survives the StrictMode start-cleanup-start sequence without leaving the first graph alive', async () => {
    const audio = createCityAudio()

    const firstStart = audio.start()
    const first = latestContext()
    audio.dispose()
    await expect(firstStart).resolves.toBeUndefined()

    await audio.start()
    const second = latestContext()
    expect(second).not.toBe(first)
    audio.dispose()

    expect(FakeAudioContext.instances).toEqual([first, second])
    for (const context of FakeAudioContext.instances) {
      expect(context.closeCalls).toBe(1)
      expect(context.nodes.every((node) => node.disconnectCalls === 1)).toBe(true)
      expect(context.oscillators.slice(-2).map((oscillator) => oscillator.stopCalls)).toEqual([1, 1])
    }
  })
})
