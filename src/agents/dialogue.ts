/**
 * The secretary's answers.
 *
 * Every reply is derived locally from the standalone scenario. No model,
 * backend, browser API, or computer integration is called.
 *
 * SECURITY: text produced here is display data. It is never interpreted, never
 * eval'd, and can never reach the desktop bridge. No dialogue path can invoke
 * an action; actions live behind explicit UI controls with their own confirm.
 */
import type { WorldSnapshot } from '../contracts/mission-control'
import { STATE_LABEL } from '../world/palette'

export interface Reply {
  text: string
  source: 'grounded' | 'model' | 'fallback'
}

type Intent =
  | 'greeting'
  | 'overview'
  | 'agents'
  | 'failures'
  | 'blocked'
  | 'cost'
  | 'connection'
  | 'model'
  | 'tasks'
  | 'navigate'
  | 'help'
  | 'unknown'

const PATTERNS: [Intent, RegExp][] = [
  ['greeting', /\b(hi|hello|hey|morning|evening|good day)\b/i],
  ['failures', /\b(fail|failed|failure|error|broke|broken|wrong|incident)\b/i],
  ['blocked', /\b(block|blocked|stuck|waiting|approval|approve|pending)\b/i],
  ['cost', /\b(cost|spend|spent|budget|token|money|price|usd|\$)\b/i],
  ['connection', /\b(connect|connected|computer|mission control|network|internet|online|offline)\b/i],
  ['model', /\b(model|provider|which model|running on|llm)\b/i],
  ['agents', /\b(agent|agents|team|who|worker|subagent)\b/i],
  ['tasks', /\b(task|tasks|job|jobs|work|working|queue|busy)\b/i],
  ['navigate', /\b(where|floor|elevator|lift|upstairs|45|headquarters|hq|go|find)\b/i],
  ['overview', /\b(status|overview|summary|everything|state|how are|what.?s happening|report)\b/i],
  ['help', /\b(help|what can you|options|ask)\b/i],
]

export function classify(question: string): Intent {
  const q = question.trim()
  if (!q) return 'unknown'
  for (const [intent, re] of PATTERNS) {
    if (re.test(q)) return intent
  }
  return 'unknown'
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function answer(
  question: string,
  snapshot: WorldSnapshot | null,
): Reply {
  if (!snapshot) {
    return {
      source: 'fallback',
      text: 'The local scenario is not ready yet. Give the headquarters a moment to finish loading.',
    }
  }

  const { status, agents } = snapshot
  const intent = classify(question)

  const byState = (s: string) => agents.filter((a) => a.state === s)
  const grounded = (text: string): Reply => ({ source: 'grounded', text })

  switch (intent) {
    case 'greeting':
      return grounded(
        `Welcome to ${status.identity}. ${plural(agents.length, 'resident')} are staged in this standalone prototype. Ask me about the headquarters, or take the lift to 45 and meet them.`,
      )

    case 'overview':
      return grounded(
        `${status.identity} is a fully standalone game scene. The plaza, lobby, automatic doors, secretary, elevator, and floor 45 route are available. ${plural(agents.length, 'fictional resident')} currently occupy the headquarters.`,
      )

    case 'agents': {
      if (agents.length === 0) return grounded('The headquarters is empty right now.')
      const active = byState('active')
      const parts = agents
        .slice(0, 6)
        .map((a) => `${a.name} (${STATE_LABEL[a.state].toLowerCase()})`)
        .join(', ')
      return grounded(
        `${plural(agents.length, 'fictional resident')} staged, ${active.length} active. ${parts}${agents.length > 6 ? ', and more' : ''}. Their offices are on floor 45.`,
      )
    }

    case 'failures': {
      const failed = byState('failed')
      if (failed.length === 0 && status.failedToday === 0) {
        return grounded('The standalone scenario has no active incident. Quiet shift.')
      }
      const names = failed.map((a) => `${a.name}${a.currentTask ? ` — ${a.currentTask}` : ''}`)
      return grounded(
        `${plural(status.failedToday, 'simulated incident')} in this scenario. ` +
          (names.length
            ? `Current incident: ${names.join('; ')}. The affected office on 45 is red.`
            : 'No resident is currently in a failed state.'),
      )
    }

    case 'blocked': {
      const blocked = byState('blocked')
      if (blocked.length === 0) {
        return grounded('Nobody in the local scenario is waiting right now.')
      }
      return grounded(
        `${plural(blocked.length, 'resident')} waiting: ${blocked.map((a) => `${a.name}${a.currentTask ? ` (${a.currentTask})` : ''}`).join('; ')}. This prototype cannot approve or execute anything on your computer.`,
      )
    }

    case 'cost':
      return grounded(
        'This standalone build spends nothing. It does not call a model provider or any paid service.',
      )

    case 'connection':
      return grounded(
        'No. This build is deliberately disconnected from your computer, Mission Control, model providers, telemetry, and external hosts. It uses only the game scenario bundled in the repository.',
      )

    case 'model':
      return grounded(
        'No AI model is connected in this build. My replies are local scripted dialogue from the game repository.',
      )

    case 'tasks':
      return grounded(
        `${plural(status.runningTasks, 'fictional activity')} running and ${status.queued} staged. These values belong only to the local game scenario, not your computer.`,
      )

    case 'navigate':
      return grounded(
        'The lift is straight ahead at the back of the lobby. Press E at the panel, choose 45 — that floor is your AI headquarters, one office per agent.',
      )

    case 'help':
      return {
        source: 'grounded',
        text: 'Ask me about the headquarters, residents, incidents, waiting work, the elevator, or whether this build is connected. Everything I say comes from the local game scenario.',
      }

    case 'unknown':
      return {
        source: 'fallback',
        text: "That is outside this prototype's scripted dialogue. I can explain the headquarters, its residents, current scenario activity, and how to reach floor 45.",
      }
  }
}
