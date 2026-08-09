/**
 * The deterministic Phase-1 tileset is a development gate, not a replacement
 * for the playable Manhattan streamer yet. Keeping selection in one pure
 * helper makes it impossible for a production URL to enable fixture content.
 */
export function shouldUsePhase1City(search: string, isDevelopment: boolean): boolean {
  if (!isDevelopment) return false
  return new URLSearchParams(search).get('city') === 'phase1'
}
