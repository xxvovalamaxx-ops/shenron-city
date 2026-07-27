/**
 * The secretary's answers.
 *
 * Grounded by construction: every fact she states is read out of the validated
 * snapshot, never generated. That is a deliberate choice, not a placeholder —
 * asking a language model "how many agents are running" when the number is
 * sitting in a struct is how a control surface starts confidently lying.
 *
 * A model seam exists (`Reply.source === 'model'`) for open-ended conversation
 * that genuinely needs one. It is NOT wired to a provider from the browser:
 * that would require a key in the client bundle, which the security boundary
 * forbids. Turning it on means routing through the backend — see
 * docs/architecture/SECURITY_BOUNDARY.md.
 *
 * SECURITY: text produced here is display data. It is never interpreted, never
 * eval'd, and can never reach the desktop bridge. No dialogue path can invoke
 * an action; actions live behind explicit UI controls with their own confirm.
 */
import type { WorldSnapshot } from '../contracts/mission-control'
import { STATE_LABEL } from '../world/palette'
import type { LinkState } from '../adapter/store'

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

function linkCaveat(link: LinkState, source: 'live' | 'demo'): string {
  if (source === 'demo') return ' Everything I just said is fixture data — this is demo mode, not your real system.'
  if (link === 'degraded') return " I should say: I've lost contact with Mission Control, so this is the last reading I got, not live."
  if (link === 'unreachable') return " Careful with that — Mission Control is unreachable and this reading is stale."
  return ''
}

export function answer(
  question: string,
  snapshot: WorldSnapshot | null,
  link: LinkState,
): Reply {
  if (!snapshot) {
    return {
      source: 'fallback',
      text: "I can't reach Mission Control at all right now, so I have nothing accurate to tell you. I'd rather say that than guess.",
    }
  }

  const { status, agents, metrics, source } = snapshot
  const caveat = linkCaveat(link, source)
  const intent = classify(question)

  const byState = (s: string) => agents.filter((a) => a.state === s)
  const grounded = (text: string): Reply => ({ source: 'grounded', text: text + caveat })

  switch (intent) {
    case 'greeting':
      return grounded(
        `Welcome back. ${status.identity} is ${STATE_LABEL[status.overall].toLowerCase()}, ${plural(status.runningTasks, 'task')} running and ${plural(agents.length, 'agent')} on the register. Ask me for a status summary, or take the lift to 45 and see them yourself.`,
      )

    case 'overview':
      return grounded(
        `${status.identity} is ${STATE_LABEL[status.overall].toLowerCase()} on ${status.model}. ` +
          `${plural(status.runningTasks, 'task')} running, ${status.queued} queued, ` +
          `${status.completedToday} completed today and ${status.failedToday} failed. ` +
          `${plural(status.toolCallsToday, 'tool call')} so far, costing $${status.costTodayUsd.toFixed(4)}. ` +
          (status.alertCount > 0
            ? `There ${status.alertCount === 1 ? 'is' : 'are'} ${plural(status.alertCount, 'open alert')}.`
            : 'No open alerts.'),
      )

    case 'agents': {
      if (agents.length === 0) return grounded('The register is empty — no agents are registered right now.')
      const active = byState('active')
      const parts = agents
        .slice(0, 6)
        .map((a) => `${a.name} (${STATE_LABEL[a.state].toLowerCase()})`)
        .join(', ')
      return grounded(
        `${plural(agents.length, 'agent')} registered, ${active.length} working. ${parts}${agents.length > 6 ? ', and more' : ''}. Floor 45 has the offices — you can look in on any of them.`,
      )
    }

    case 'failures': {
      const failed = byState('failed')
      if (failed.length === 0 && status.failedToday === 0) {
        return grounded('Nothing has failed today, and no agent is in a failed state. Quiet day.')
      }
      const names = failed.map((a) => `${a.name}${a.currentTask ? ` — ${a.currentTask}` : ''}`)
      return grounded(
        `${plural(status.failedToday, 'failure')} today. ` +
          (names.length
            ? `Currently failed: ${names.join('; ')}. Their offices on 45 are the red ones.`
            : 'No agent is sitting in a failed state right now, so those were transient.'),
      )
    }

    case 'blocked': {
      const blocked = byState('blocked')
      if (blocked.length === 0) {
        return grounded('Nothing is blocked and nothing is waiting on your approval.')
      }
      return grounded(
        `${plural(blocked.length, 'agent')} blocked: ${blocked.map((a) => `${a.name}${a.currentTask ? ` (${a.currentTask})` : ''}`).join('; ')}. Approvals are yours to give — I can't grant them for you.`,
      )
    }

    case 'cost':
      return grounded(
        `$${status.costTodayUsd.toFixed(4)} today across ${plural(status.toolCallsToday, 'tool call')}. That's on ${status.model} via ${status.provider}.`,
      )

    case 'model':
      return grounded(
        `${status.identity} is running ${status.model} through ${status.provider}. Reasoning load today: ${status.toolCallsToday} tool calls.`,
      )

    case 'tasks':
      return grounded(
        `${plural(status.runningTasks, 'task')} running, ${status.queued} queued. ${status.completedToday} done today, ${status.failedToday} failed. The host is at ${Math.round(metrics.cpu)}% CPU and ${Math.round(metrics.memory)}% memory.`,
      )

    case 'navigate':
      return grounded(
        'The lift is straight ahead at the back of the lobby. Press E at the panel, choose 45 — that floor is your AI headquarters, one office per agent.',
      )

    case 'help':
      return {
        source: 'grounded',
        text: 'Ask me about status, agents, failures, blocked work, tasks, cost, or which model is running. I read those straight from Mission Control, so they are accurate or I tell you they are stale.',
      }

    case 'unknown':
      return {
        source: 'fallback',
        text: "That's outside what I can answer accurately. I only speak from what Mission Control actually reports — status, agents, failures, blocked work, tasks and cost. I'd rather say I don't know than invent it.",
      }
  }
}
