/**
 * The grade as a function of the light.
 *
 * Day: a gentle teal-orange split and a little contrast. Golden hour: warmer
 * highlights, lifted warm shadows, more saturation — the "everything glows"
 * frame. Night: cool, slightly lifted blue shadows so silhouettes stay
 * readable against the sky, warm highlights so sodium and windows pop, and
 * more contrast. Rain desaturates and cools everything.
 *
 * Pure; the numbers are tested for range and continuity over the whole day.
 */
import type { GradeParams } from './grade-effect'
import type { AtmosphereState } from './model'

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
type V3 = [number, number, number]
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

interface Look {
  lift: V3
  gamma: V3
  gain: V3
  shadowTint: V3
  highlightTint: V3
  split: number
  contrast: number
  saturation: number
}

const DAY: Look = {
  lift: [0.0, 0.002, 0.006],
  gamma: [1.0, 1.0, 1.0],
  gain: [1.0, 1.0, 0.99],
  shadowTint: [-0.012, 0.003, 0.016],
  highlightTint: [0.022, 0.009, -0.018],
  split: 1,
  contrast: 1.06,
  saturation: 1.1,
}

const GOLDEN: Look = {
  lift: [0.012, 0.004, 0.012],
  gamma: [1.02, 1.0, 0.97],
  gain: [1.03, 1.0, 0.95],
  shadowTint: [-0.02, 0.0, 0.03],
  highlightTint: [0.035, 0.012, -0.03],
  split: 1,
  contrast: 1.08,
  saturation: 1.16,
}

const NIGHT: Look = {
  lift: [0.004, 0.012, 0.03],
  gamma: [1.0, 1.02, 1.06],
  gain: [1.02, 1.0, 0.98],
  shadowTint: [-0.02, 0.006, 0.035],
  highlightTint: [0.04, 0.014, -0.03],
  split: 1,
  contrast: 1.1,
  saturation: 1.12,
}

export function gradeFor(state: AtmosphereState): GradeParams {
  const g = state.golden * (1 - state.night)
  let look = blend(DAY, GOLDEN, g)
  look = blend(look, NIGHT, state.night)
  const rain = state.rain
  return {
    lift: look.lift,
    gamma: look.gamma,
    gain: look.gain,
    shadowTint: look.shadowTint,
    highlightTint: look.highlightTint,
    split: look.split * lerp(1, 0.6, rain),
    contrast: look.contrast * lerp(1, 0.97, rain),
    saturation: look.saturation * lerp(1, 0.82, rain),
    grain: lerp(0.014, 0.024, state.night),
  }
}

function blend(a: Look, b: Look, t: number): Look {
  return {
    lift: mix3(a.lift, b.lift, t),
    gamma: mix3(a.gamma, b.gamma, t),
    gain: mix3(a.gain, b.gain, t),
    shadowTint: mix3(a.shadowTint, b.shadowTint, t),
    highlightTint: mix3(a.highlightTint, b.highlightTint, t),
    split: lerp(a.split, b.split, t),
    contrast: lerp(a.contrast, b.contrast, t),
    saturation: lerp(a.saturation, b.saturation, t),
  }
}
