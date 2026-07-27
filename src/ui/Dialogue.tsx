/**
 * Conversation with the secretary.
 *
 * Her replies are display text and nothing else. There is no path from this
 * component to an action, a command, or the desktop bridge — an NPC saying
 * "restart the server" produces the string, not the restart. Consequential
 * things live behind explicit controls with their own confirmation.
 */
import { useEffect, useRef, useState } from 'react'
import { useGame } from '../adapter/store'
import { answer, type Reply } from '../agents/dialogue'
import { SECRETARY_NAME } from '../agents/Secretary'

interface Turn {
  who: 'you' | 'her'
  text: string
  source?: Reply['source']
}

const SUGGESTIONS = [
  'What is happening right now?',
  'Who is on floor 45?',
  'Are there any incidents?',
  'Is anyone waiting?',
  'Is this connected to my computer?',
  'How do I reach floor 45?',
]

export function Dialogue({ onClose }: { onClose(): void }) {
  const snapshot = useGame((s) => s.snapshot)

  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Open with a greeting so the player is never staring at an empty box.
  useEffect(() => {
    const reply = answer('hello', snapshot)
    setTurns([{ who: 'her', text: reply.text, source: reply.source }])
    inputRef.current?.focus()
    // Intentionally once, on open — the greeting should not re-fire as data
    // ticks in behind the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const ask = (question: string) => {
    const q = question.trim()
    if (!q) return
    const reply = answer(q, snapshot)
    setTurns((t) => [
      ...t,
      { who: 'you', text: q },
      { who: 'her', text: reply.text, source: reply.source },
    ])
    setDraft('')
  }

  const close = onClose

  return (
    <div
      className="modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div className="dialogue">
        <header>
          <div>
            <h3>{SECRETARY_NAME}</h3>
            <small>RECEPTION · STANDALONE SCRIPTED GAME CHARACTER</small>
          </div>
          <button className="ghost small" onClick={close}>
            Close · Esc
          </button>
        </header>

        <div className="log" ref={logRef}>
          {turns.map((t, i) => (
            <div
              key={i}
              className={`turn ${t.who === 'you' ? 'you' : ''} ${
                t.source === 'fallback' ? 'fallback' : ''
              }`}
            >
              <label>{t.who === 'you' ? 'YOU' : SECRETARY_NAME.toUpperCase()}</label>
              <p>{t.text}</p>
            </div>
          ))}
        </div>

        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="small ghost" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>

        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault()
            ask(draft)
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Ask ${SECRETARY_NAME} about the headquarters…`}
            aria-label="Ask the secretary a question"
          />
          <button className="primary" type="submit" disabled={!draft.trim()}>
            Ask
          </button>
        </form>
      </div>
    </div>
  )
}
