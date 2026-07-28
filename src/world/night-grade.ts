/**
 * Night albedo grade for imported city models.
 *
 * The CC0 city kit is authored for daylight: its colormap is near-white, and a
 * near-white surface stays bright under any light rig that still lets you see
 * where you are walking. Rebalancing key-to-fill got the geometry its form
 * back but could not make the buildings read as night — that is an albedo
 * problem, and it has to be fixed on the material.
 *
 * Two things happen here. Brightness comes down, and the residual is pushed
 * slightly toward the sky's blue so unlit faces sit in the same colour family
 * as the night around them. Warm practicals — signage, headlights, windows —
 * are unaffected because they are emissive and unlit, so lowering albedo makes
 * them relatively brighter, which is exactly the night look.
 *
 * Pure, so the numbers are testable and the reasoning stays in one place.
 */

/** Multiplier on the model's authored albedo. */
export const NIGHT_ALBEDO = 0.44

/** How far to pull the residual toward the night sky colour, 0..1. */
export const NIGHT_COOL_MIX = 0.22

/** The sky the city sits under. Matches PALETTE.horizon. */
export const NIGHT_SKY = { r: 0x0b / 255, g: 0x16 / 255, b: 0x26 / 255 }

export interface Rgb {
  r: number
  g: number
  b: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Grade one authored colour to its night value.
 *
 * Non-finite channels fall back to the input rather than producing NaN, which
 * would render as black and be read as a missing texture.
 */
export function gradeToNight(
  colour: Rgb,
  albedo = NIGHT_ALBEDO,
  coolMix = NIGHT_COOL_MIX,
  sky: Rgb = NIGHT_SKY,
): Rgb {
  const a = Number.isFinite(albedo) ? clamp01(albedo) : 1
  const m = Number.isFinite(coolMix) ? clamp01(coolMix) : 0

  const channel = (value: number, skyValue: number): number => {
    if (!Number.isFinite(value)) return value
    const dimmed = value * a
    return clamp01(dimmed * (1 - m) + skyValue * m)
  }

  return {
    r: channel(colour.r, sky.r),
    g: channel(colour.g, sky.g),
    b: channel(colour.b, sky.b),
  }
}

/** Perceived luminance, for asserting the grade actually darkens. */
export function luminance(colour: Rgb): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
}
