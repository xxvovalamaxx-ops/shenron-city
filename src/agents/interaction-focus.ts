import type { InteractKind } from '../gameplay/interact'

export interface InteractionFocus {
  kind: InteractKind | null
  payload: string | null
}

/**
 * One interaction target owns the world marker shown with the HUD prompt.
 *
 * `payload` is optional for singleton targets such as the secretary. Requiring
 * it for named characters and offices prevents every nearby resident from
 * lighting up when only one is actually selectable.
 */
export function interactionFocusMatches(
  focus: InteractionFocus,
  kind: InteractKind,
  payload?: string,
): boolean {
  if (focus.kind !== kind) return false
  return payload === undefined || focus.payload === payload
}
