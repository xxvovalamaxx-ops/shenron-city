import type { InteractKind } from './interact'

export interface HudMirror {
  promptLabel: string | null
  promptKind: InteractKind | null
  promptPayload: string | null
  floorLabel: string
  elevatorPhase: string
  fps: number
  frameMs: number
}

/** Keep the throttled React mirror truthful without writing at frame rate. */
export function hudMirrorChanged(next: HudMirror, current: HudMirror): boolean {
  return (
    next.promptLabel !== current.promptLabel ||
    next.promptKind !== current.promptKind ||
    next.promptPayload !== current.promptPayload ||
    next.floorLabel !== current.floorLabel ||
    next.elevatorPhase !== current.elevatorPhase ||
    next.fps !== current.fps ||
    next.frameMs !== current.frameMs
  )
}
