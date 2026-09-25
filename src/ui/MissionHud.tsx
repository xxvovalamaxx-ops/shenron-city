/**
 * The mission layer of the HUD: GTA's objective subtitle at the bottom
 * centre and the job clock under the wanted stars.
 *
 * The director writes plain module state; this polls its revision counter a
 * few times a second instead of subscribing, so a running job costs React
 * four renders a second at most.
 */
import { useEffect, useState } from 'react'
import { director } from '../gameplay/director/director-state'

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function MissionHud() {
  const [, setRevision] = useState(director.revision)

  useEffect(() => {
    const id = setInterval(() => setRevision(director.revision), 250)
    return () => clearInterval(id)
  }, [])

  const text = director.objectiveText
  const timeLeft = director.timeLeft
  if (!text && timeLeft === null) return null

  return (
    <>
      {text && (
        <div className="mission-objective" role="status">
          {text}
        </div>
      )}
      {timeLeft !== null && (
        <div className={`mission-timer${timeLeft <= 15 ? ' urgent' : ''}`}>
          <span>TIME</span>
          <b>{formatClock(timeLeft)}</b>
        </div>
      )}
    </>
  )
}
