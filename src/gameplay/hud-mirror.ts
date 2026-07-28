import type { InteractKind } from './interact'

export interface HudMirror {
  promptLabel: string | null
  promptKind: InteractKind | null
  promptPayload: string | null
  floorLabel: string
  elevatorPhase: string
  fps: number
  frameMs: number
  tourBearing: number | null
  tourDistance: number | null
  mapPlayerX: number
  mapPlayerZ: number
  mapHeading: number
  mapTargetX: number | null
  mapTargetZ: number | null
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
    next.frameMs !== current.frameMs ||
    next.tourBearing !== current.tourBearing ||
    next.tourDistance !== current.tourDistance ||
    next.mapPlayerX !== current.mapPlayerX ||
    next.mapPlayerZ !== current.mapPlayerZ ||
    next.mapHeading !== current.mapHeading ||
    next.mapTargetX !== current.mapTargetX ||
    next.mapTargetZ !== current.mapTargetZ
  )
}
