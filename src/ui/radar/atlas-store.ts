/**
 * One street atlas per session, shared by the radar and the pause map, so a
 * tile rendered for one is there for the other.
 */
import { useEffect, useState } from 'react'
import { StreetAtlas } from './street-atlas'
import { loadStreetData, streetDataNow } from './street-data'

let atlas: StreetAtlas | null = null

export function atlasNow(): StreetAtlas | null {
  if (!atlas) {
    const data = streetDataNow()
    if (data) atlas = new StreetAtlas(data)
  }
  return atlas
}

/** The shared atlas, loading the street graph on first use. */
export function useStreetAtlas(): StreetAtlas | null {
  const [ready, setReady] = useState<StreetAtlas | null>(() => atlasNow())
  useEffect(() => {
    if (ready) return
    let alive = true
    loadStreetData()
      .then(() => {
        if (alive) setReady(atlasNow())
      })
      .catch((error: unknown) => console.warn('[radar] street graph unavailable', error))
    return () => {
      alive = false
    }
  }, [ready])
  return ready
}
