// audio.js — the city, synthesised.
//
// There is not one audio file in this repository and there is not going to be.
// Free sample packs almost all forbid redistribution inside a build, field
// recordings of a real street carry the rights of whoever made them, and the
// project's own rules (docs/phase2/LICENSING.md) do not allow shipping either
// on a maybe. So every sound here is generated from oscillators and noise at
// runtime — nothing to license, nothing to download, about 6 KB of code.
//
// Six layers, each driven by what the simulation is actually doing:
//
//   traffic   brown noise through a low-pass, level from vehicles in earshot
//   tyres     band-passed noise, the wet hiss, level from rain and traffic
//   crowd     slow-modulated band-passed noise, level from pedestrians nearby
//   wind      high band-passed noise, level from altitude and camera speed
//   rain      broadband hiss plus a high shimmer, level from rain intensity
//   events    two-tone sirens and horns, triggered, panned, distance-rolled
//
// Everything is built against a BaseAudioContext, so the whole graph can be
// rendered into an OfflineAudioContext and measured. That is how it is tested:
// see verify() at the bottom.
//
// Phase 3B adds the indoor transition: the layer sum runs through a low-pass
// filter and a gain that follow the player's indoor blend (0 outdoors, 1 in a
// room, 0..1 in a doorway threshold), plus a low HVAC-ish hum layer that only
// exists indoors, plus a synthesized door swish for the automatic doors. All
// of it is still oscillators and noise -- nothing to license.

const NOISE_SECONDS = 4

// One shared noise buffer. Generating white noise per layer costs the same
// memory several times over for no audible benefit, and a shared buffer read
// at different rates decorrelates the layers well enough.
function noiseBuffer(ctx, kind = 'white') {
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  if (kind === 'brown') {
    // Integrated white noise: -6 dB/octave, which is what a distant road is.
    let last = 0
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    }
  } else {
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }
  return buf
}

function noiseSource(ctx, buf, rate = 1) {
  const s = ctx.createBufferSource()
  s.buffer = buf
  s.loop = true
  s.playbackRate.value = rate
  return s
}

// A layer is a looping noise source through a filter into its own gain, so the
// simulation only ever has to move one number per layer.
function layer(ctx, buf, { type, freq, q = 1, rate = 1, gain = 0 }) {
  const src = noiseSource(ctx, buf, rate)
  const filt = ctx.createBiquadFilter()
  filt.type = type
  filt.frequency.value = freq
  filt.Q.value = q
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(filt).connect(g)
  return { src, filt, gain: g }
}

export class CityAudio {
  constructor() {
    this.ctx = null
    this.enabled = false
    this.master = null
    this.layers = {}
    this.lastSiren = 0
    this.lastHorn = 0
    this.clock = 0
    this.stats = { running: false, traffic: 0, crowd: 0, rain: 0, wind: 0 }
  }

  // Browsers will not start an AudioContext without a gesture, so this is
  // called from the first click or key rather than at boot.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      this.enabled = true
      this.stats.running = true
      return this
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return this
    this.ctx = new AC()
    this.build(this.ctx, this.ctx.destination)
    this.enabled = true
    this.stats.running = true
    return this
  }

  // Split out from start() so the identical graph can be built inside an
  // OfflineAudioContext and measured.
  build(ctx, destination) {
    this.ctx = ctx
    const white = noiseBuffer(ctx, 'white')
    const brown = noiseBuffer(ctx, 'brown')
    this.buffers = { white, brown }

    const master = ctx.createGain()
    master.gain.value = 0.9
    // Nothing here should ever be able to clip the output, however many
    // sirens happen to overlap.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.004
    limiter.release.value = 0.25
    master.connect(limiter).connect(destination)
    this.master = master
    this.limiter = limiter

    this.layers = {
      // A street is mostly engine and tyre roar below 500 Hz.
      traffic: layer(ctx, brown,
        { type: 'lowpass', freq: 380, q: 0.7, rate: 1.0 }),
      // Tyres on wet tarmac: a band an octave or two up, and the thing that
      // actually makes rain sound like rain in a city rather than in a field.
      tyres: layer(ctx, white,
        { type: 'bandpass', freq: 1500, q: 0.8, rate: 0.85 }),
      // Voices carry as a band around 500 Hz once you cannot hear the words.
      crowd: layer(ctx, white,
        { type: 'bandpass', freq: 520, q: 1.6, rate: 0.6 }),
      wind: layer(ctx, white,
        { type: 'bandpass', freq: 900, q: 0.5, rate: 1.2 }),
      rain: layer(ctx, white,
        { type: 'highpass', freq: 1100, q: 0.6, rate: 1.0 }),
      rainHigh: layer(ctx, white,
        { type: 'bandpass', freq: 4800, q: 0.7, rate: 1.35 }),
    }
    // Slow swell on the crowd so it breathes instead of sitting flat.
    //
    // The modulation goes into a gain node of its own, in series, not into
    // the crowd layer's own gain param. An oscillator connected to a param is
    // *added* to that param's value, so driving the layer's own gain meant
    // setting it to zero still left the crowd swinging between plus and minus
    // 0.35 -- the murmur could never actually be switched off, and a mix with
    // every layer at zero measured 0.0165 RMS instead of silence.
    const crowdMod = ctx.createGain()
    crowdMod.gain.value = 0.65
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.35
    lfo.connect(lfoGain).connect(crowdMod.gain)
    lfo.start()
    this.lfo = lfo
    this.crowdMod = crowdMod

    // The layer sum runs through the room bus: a low-pass and a gain that
    // follow the indoor blend, so a room swallows the street instead of the
    // street swallowing the room. At blend 0 the filter is open and the gain
    // is unity, so the outdoor mix is byte-identical to what it was before.
    const roomBus = ctx.createGain()
    roomBus.gain.value = 1
    const roomFilter = ctx.createBiquadFilter()
    roomFilter.type = 'lowpass'
    roomFilter.frequency.value = 20000
    roomFilter.Q.value = 0.5
    const roomGain = ctx.createGain()
    roomGain.gain.value = 1
    roomBus.connect(roomFilter).connect(roomGain).connect(master)

    // indoor hum: a low brown bed, the HVAC the real buildings would have
    const hum = layer(ctx, brown,
      { type: 'lowpass', freq: 130, q: 0.9, rate: 0.4, gain: 0 })
    hum.gain.connect(master)

    for (const [name, l] of Object.entries(this.layers)) {
      if (name === 'crowd') l.gain.connect(crowdMod).connect(roomBus)
      else l.gain.connect(roomBus)
    }
    this.roomBus = roomBus
    this.roomFilter = roomFilter
    this.roomGain = roomGain
    this.hum = hum
    this.indoor = 0

    for (const l of Object.values(this.layers)) l.src.start()
    hum.src.start()
    return this
  }

  _ramp(param, value, t = 0.35) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    param.cancelScheduledValues(now)
    param.setTargetAtTime(Math.max(0, value), now, t)
  }

  // A NYC wail: two tones alternating, swept, rolled off with distance and
  // panned to one side so it reads as somewhere else in the city.
  siren(distance = 300, pan = 0) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const dur = 3.6
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 2.2
    const g = ctx.createGain()
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    // inverse-distance, floored so a siren 2 km away is not a division by zero
    const level = 0.16 * Math.min(1, 180 / Math.max(60, distance))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.35)
    g.gain.setTargetAtTime(0, t + dur - 1.0, 0.5)
    for (let i = 0; i < 6; i++) {
      const a = t + i * 0.6
      osc.frequency.setValueAtTime(660, a)
      osc.frequency.exponentialRampToValueAtTime(1180, a + 0.3)
      osc.frequency.exponentialRampToValueAtTime(700, a + 0.6)
    }
    osc.connect(band).connect(g)
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p)
      p.connect(this.master) } else { g.connect(this.master) }
    osc.start(t)
    osc.stop(t + dur)
  }

  horn(distance = 40, pan = 0) {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const g = ctx.createGain()
    const level = 0.20 * Math.min(1, 30 / Math.max(8, distance))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(level, t + 0.02)
    g.gain.setTargetAtTime(0, t + 0.28, 0.06)
    // A car horn is two close tones, which is what gives it the beating edge
    const oscs = []
    for (const f of [392, 466]) {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = f
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 2200
      o.connect(lp).connect(g)
      oscs.push(o)
    }
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p)
      p.connect(this.master) } else { g.connect(this.master) }
    for (const o of oscs) { o.start(t); o.stop(t + 0.55) }
  }

  // The indoor blend drives the room low-pass, the room gain and the HVAC
  // hum. split out of update() so the OfflineAudioContext verification can
  // measure an indoor mix without a camera.
  setIndoor(blend) {
    if (!this.ctx) return
    this.indoor = Math.max(0, Math.min(1, blend))
    if (this.roomFilter) {
      this._ramp(this.roomFilter.frequency,
        20000 - (20000 - 750) * this.indoor, 0.4)
      this._ramp(this.roomGain.gain, 1 - 0.55 * this.indoor, 0.4)
      this._ramp(this.hum.gain.gain, this.indoor * 0.020, 0.6)
    }
  }

  // A synthesized automatic-door swish: a short band-passed noise burst with
  // a quick attack and a slower tail, kept quiet so it never reads as a
  // sound effect on top of the street.
  doorSwish() {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const dur = 0.9
    const src = ctx.createBufferSource()
    src.buffer = this.buffers.brown
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.setValueAtTime(1400, t)
    band.frequency.exponentialRampToValueAtTime(600, t + dur)
    band.Q.value = 1.4
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.030, t + 0.10)
    g.gain.setTargetAtTime(0, t + 0.25, 0.16)
    src.loop = true
    src.connect(band).connect(g).connect(this.roomBus)
    src.start(t)
    src.stop(t + dur)
  }

  // Drive the mix from the simulation rather than from a timeline.
  update(dt, { camera, traffic, crowd, weather, controls }) {
    if (!this.enabled || !this.ctx) return this.stats
    this.clock += dt
    const L = this.layers

    const cx = camera.position.x
    const cz = camera.position.z
    const alt = Math.max(0, camera.position.y - (weather?.groundY ?? 12))

    // vehicles within earshot, weighted by inverse distance
    let vNear = 0
    let closest = 1e9
    let closestPan = 0
    if (traffic?.vehicles) {
      for (const v of traffic.vehicles) {
        const lane = traffic.lanes[v.lane]
        if (!lane) continue
        const p = lane.pts[(lane.pts.length / 2) | 0]
        const d = Math.hypot(p[0] - cx, -p[1] - cz)
        if (d > 160) continue
        vNear += 1 / (1 + d * 0.05)
        if (d < closest) {
          closest = d
          closestPan = Math.max(-1, Math.min(1, (p[0] - cx) / 60))
        }
      }
    }
    let pNear = 0
    if (crowd?.people) {
      for (const p of crowd.people) {
        const lane = crowd.lanes[p.lane]
        if (!lane) continue
        const q = lane.pts[(lane.pts.length / 2) | 0]
        const d = Math.hypot(q[0] - cx, -q[1] - cz)
        if (d < 70) pNear += 1 / (1 + d * 0.08)
      }
    }

    const rain = weather?.rain ?? 0
    // Above the rooftops the street falls away and the wind takes over.
    const high = Math.min(1, alt / 220)
    // Phase 3B: indoor blend, 0 outdoors -> 1 inside a room, with the
    // doorways' thresholds in between (doors.indoorBlend).
    const indoors = interiors?.inside ? 1
      : (doors ? doors.indoorBlend(camera) : 0)
    this.setIndoor(indoors)

    const trafficLevel = Math.min(0.32, vNear * 0.010) * (1 - high * 0.85)
    const tyreLevel = Math.min(0.16, vNear * 0.004) * (0.35 + rain * 1.4) *
      (1 - high * 0.9)
    const crowdLevel = Math.min(0.13, pNear * 0.007) * (1 - high * 0.95) *
      (1 - rain * 0.5)
    const windLevel = 0.006 + high * 0.075 +
      (controls?.speed ? Math.min(0.05, controls.speed * 0.0008) : 0)
    const rainLevel = rain * 0.16 * (1 - indoors)
    const rainHighLevel = rain * rain * 0.09

    this._ramp(L.traffic.gain.gain, trafficLevel)
    this._ramp(L.tyres.gain.gain, tyreLevel)
    this._ramp(L.crowd.gain.gain, crowdLevel)
    this._ramp(L.wind.gain.gain, windLevel, 0.8)
    this._ramp(L.rain.gain.gain, rainLevel, 0.6)
    this._ramp(L.rainHigh.gain.gain, rainHighLevel, 0.6)
    // rain on a hard surface is brighter the heavier it gets
    this._ramp(L.rain.filt.frequency, 900 + rain * 700, 1.0)

    // Events. Manhattan really does average a siren every couple of minutes
    // in the busy parts, and far more in Midtown than in Inwood.
    const busy = Math.min(1, vNear / 12)
    if (this.clock - this.lastSiren > 26 &&
        Math.random() < dt * 0.05 * (0.3 + busy)) {
      this.lastSiren = this.clock
      this.siren(180 + Math.random() * 900, Math.random() * 2 - 1)
    }
    if (this.clock - this.lastHorn > 3.5 &&
        Math.random() < dt * 0.28 * busy) {
      this.lastHorn = this.clock
      this.horn(Math.max(12, closest), closestPan)
    }

    this.stats = {
      running: true,
      traffic: +trafficLevel.toFixed(4),
      crowd: +crowdLevel.toFixed(4),
      rain: +rainLevel.toFixed(4),
      wind: +windLevel.toFixed(4),
      vehiclesNear: +vNear.toFixed(1),
      peopleNear: +pNear.toFixed(1),
    }
    return this.stats
  }

  setMuted(m) {
    this.enabled = !m
    if (this.master) this._ramp(this.master.gain, m ? 0 : 0.9, 0.15)
    this.stats.running = !m
  }
}

// Render the real graph offline and measure it, so "there is audio" is a
// measurement rather than a claim. Returns RMS and spectral centroid for a
// set of named mixes.
export async function verify(seconds = 1.5) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!OAC) return { error: 'no OfflineAudioContext' }

  const run = async (setup) => {
    const ctx = new OAC(1, Math.ceil(44100 * seconds), 44100)
    const a = new CityAudio()
    a.build(ctx, ctx.destination)
    a.enabled = true
    setup(a, ctx)
    const buf = await ctx.startRendering()
    const d = buf.getChannelData(0)
    let sum = 0
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i]
    const rms = Math.sqrt(sum / d.length)

    // Spectral centroid by a coarse Goertzel sweep -- enough to tell a
    // low-frequency traffic bed from a high-frequency rain hiss. The 1.5 kHz
    // bin is recorded separately because that is the tyres band, the highest
    // content in a dry street mix -- the band the indoor low-pass cuts first.
    let num = 0
    let den = 0
    let mag1500 = 0
    for (let f = 100; f <= 8000; f *= 1.25) {
      const w = 2 * Math.PI * f / 44100
      const c = 2 * Math.cos(w)
      let s1 = 0
      let s2 = 0
      const step = 4                    // decimate; we want shape, not detail
      for (let i = 0; i < d.length; i += step) {
        const s0 = d[i] + c * s1 - s2
        s2 = s1
        s1 = s0
      }
      const mag = Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2)
      num += f * mag
      den += mag
      if (Math.abs(f - 1500) < 200) mag1500 += mag
    }
    return { rms: +rms.toFixed(5),
      centroid: Math.round(den ? num / den : 0),
      mag1500: +mag1500.toFixed(3) }
  }

  const silent = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
  })
  const trafficOnly = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.layers.traffic.gain.gain.value = 0.30
  })
  const rainOnly = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.layers.rain.gain.gain.value = 0.20
    a.layers.rainHigh.gain.gain.value = 0.10
  })
  const sirenOnly = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.siren(120, 0)
  })
  const hornOnly = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.horn(15, 0)
  })
  // Phase 3B: the same street mix, heard through a closed threshold. The
  // room filter/gain are set to their steady-state indoor values (the ramp
  // is a runtime nicety; this measures what indoors *is*): the 1.5 kHz tyres
  // band must be cut hard and the mix must be quieter.
  const streetOnly = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.layers.traffic.gain.gain.value = 0.25
    a.layers.tyres.gain.gain.value = 0.10
    a.layers.crowd.gain.gain.value = 0.08
  })
  const streetIndoor = await run((a) => {
    for (const l of Object.values(a.layers)) l.gain.gain.value = 0
    a.layers.traffic.gain.gain.value = 0.25
    a.layers.tyres.gain.gain.value = 0.10
    a.layers.crowd.gain.gain.value = 0.08
    a.roomFilter.frequency.value = 750
    a.roomGain.gain.value = 0.45
    a.hum.gain.gain.value = 0.02
  })
  return { silent, trafficOnly, rainOnly, sirenOnly, hornOnly,
    streetOnly, streetIndoor }
}
