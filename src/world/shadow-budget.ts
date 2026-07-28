/**
 * Spend the shadow pass on shadows you can actually see.
 *
 * Every shadow caster is drawn a second time, into the shadow map. Measured in
 * the running game: 470 of 904 meshes cast, and the median caster's world
 * radius was 0.47 m against a 0.176 m shadow texel — under three texels across.
 * Those are not shadows, they are a few grey pixels, and each one costs a full
 * draw call. Bollards, stall legs, kerb strips and signage quads made up most
 * of it.
 *
 * The threshold is derived from shadow-map resolution rather than hardcoded, so
 * it follows the quality preset for free: the same rule that keeps prop shadows
 * at 2048 drops them at 512, which is exactly what a low preset wants.
 *
 * Pure and framework-free so the rule is testable without a renderer.
 */

/** Ground covered by one shadow-map texel, in metres. */
export function shadowTexelSize(cameraExtent: number, mapSize: number): number {
  if (!Number.isFinite(cameraExtent) || cameraExtent <= 0) return Infinity
  if (!Number.isFinite(mapSize) || mapSize <= 0) return Infinity
  return cameraExtent / mapSize
}

/**
 * How many texels across a shadow must be before it reads as a shape.
 *
 * Below about this, percentage-closer filtering has smeared it into a grey
 * patch that is indistinguishable from ambient occlusion — and a grey patch is
 * not worth a draw call.
 */
export const MIN_SHADOW_TEXELS = 6

/** Smallest world radius worth casting, for a given texel size. */
export function minShadowCasterRadius(
  texelSize: number,
  minTexels = MIN_SHADOW_TEXELS,
): number {
  if (!Number.isFinite(texelSize)) return Infinity
  // minTexels is a diameter; radius is half of it.
  return (texelSize * minTexels) / 2
}

/**
 * Should a mesh of this world radius cast?
 *
 * Characters are exempted by the caller rather than by size: a person is the
 * one thing a player watches closely enough that a missing shadow reads as a
 * bug, even when the shadow itself is small.
 */
export function shouldCastShadow(
  worldRadius: number,
  texelSize: number,
  minTexels = MIN_SHADOW_TEXELS,
): boolean {
  if (!Number.isFinite(worldRadius) || worldRadius <= 0) return false
  return worldRadius >= minShadowCasterRadius(texelSize, minTexels)
}
