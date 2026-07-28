/**
 * Characters are sized in metres, not at whatever scale the artist exported.
 *
 * The CC0 packs are authored at wildly different sizes — the Kenney citizen
 * arrives about 3.76 m tall and the Quaternius hero about 2.19 m — and every
 * component rendered its GLB with a bare `<primitive>`, so pedestrians stood
 * more than twice human height next to 2 m market stalls. Downstream code then
 * multiplied by 0.94–1.04 "variation", which quietly assumed a normalised
 * model and could not have fixed it.
 *
 * So each character component measures what it actually loaded and normalises
 * to a requested height. Measured, not a hardcoded per-model constant: swap an
 * asset and the scale still comes out right instead of silently regressing.
 *
 * This mirrors world/PlanterTree.ts, where the same class of bug produced 34 m
 * trees in 2.4 m planters.
 */

/** A standing adult. PLAYER_HEIGHT in gameplay/collision.ts is 1.78 m. */
export const DEFAULT_CHARACTER_HEIGHT = 1.75

/** Anything outside this is a broken measurement, not a stylistic choice. */
export const MIN_NATURAL_HEIGHT = 1e-4

/**
 * Scale factor that turns a model of `naturalHeight` into one of `target`.
 *
 * Returns 1 for a degenerate measurement rather than Infinity or NaN: a
 * character at its authored size is wrong but visible and reportable, whereas
 * one scaled by Infinity vanishes and takes the frame's bounds with it.
 */
export function heightScaleFor(naturalHeight: number, target = DEFAULT_CHARACTER_HEIGHT): number {
  if (!Number.isFinite(naturalHeight) || naturalHeight < MIN_NATURAL_HEIGHT) return 1
  if (!Number.isFinite(target) || target <= 0) return 1
  return target / naturalHeight
}

/**
 * True when a measured height is close enough to the target to be believable.
 * Used by tests as the regression guard, and cheap enough to assert in dev.
 */
export function isPlausibleCharacterHeight(height: number, target = DEFAULT_CHARACTER_HEIGHT): boolean {
  if (!Number.isFinite(height)) return false
  return height > target * 0.55 && height < target * 1.6
}
