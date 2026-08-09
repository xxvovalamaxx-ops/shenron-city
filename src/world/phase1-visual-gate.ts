export interface Phase1VisualGateSnapshot {
  releaseVerified: boolean
  gameplayReady: boolean
  terminalVisualErrors: number
  requiredTileIds: string[]
  loadedRequiredTileIds: string[]
  visibleRequiredTileIds: string[]
  enterable: boolean
}

/**
 * A deliberately monotonic entry gate: a terminal visual failure can never be
 * cleared by a later model event in the same runtime ownership epoch.
 */
export class Phase1VisualGate {
  private readonly required = new Set<string>()
  private readonly loaded = new Set<string>()
  private readonly visible = new Set<string>()
  private releaseVerified = false
  private gameplayReady = false
  private terminalVisualErrors = 0

  constructor(requiredTileIds: readonly string[]) {
    for (const tileId of requiredTileIds) this.required.add(tileId)
  }

  verifyRelease(): void {
    this.releaseVerified = true
  }

  setGameplayReady(ready: boolean): void {
    this.gameplayReady = ready
  }

  modelLoaded(tileId: string | null): void {
    if (tileId && this.required.has(tileId)) this.loaded.add(tileId)
  }

  modelDisposed(tileId: string | null): void {
    if (!tileId || !this.required.has(tileId)) return
    this.loaded.delete(tileId)
    this.visible.delete(tileId)
  }

  visibilityChanged(tileId: string | null, visible: boolean): void {
    if (!tileId || !this.required.has(tileId)) return
    if (visible) this.visible.add(tileId)
    else this.visible.delete(tileId)
  }

  terminalVisualError(): void {
    this.terminalVisualErrors += 1
  }

  snapshot(): Readonly<Phase1VisualGateSnapshot> {
    const requiredTileIds = [...this.required].sort()
    const loadedRequiredTileIds = [...this.loaded].sort()
    const visibleRequiredTileIds = [...this.visible].sort()
    const everyRequiredModelLoaded =
      loadedRequiredTileIds.length === requiredTileIds.length &&
      loadedRequiredTileIds.every((tileId, index) => tileId === requiredTileIds[index])
    return Object.freeze({
      releaseVerified: this.releaseVerified,
      gameplayReady: this.gameplayReady,
      terminalVisualErrors: this.terminalVisualErrors,
      requiredTileIds,
      loadedRequiredTileIds,
      visibleRequiredTileIds,
      enterable:
        this.releaseVerified &&
        everyRequiredModelLoaded &&
        visibleRequiredTileIds.length > 0 &&
        this.gameplayReady &&
        this.terminalVisualErrors === 0,
    })
  }
}
