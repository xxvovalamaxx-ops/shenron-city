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

export type CharacterId = 'iris' | 'mira' | 'kai'

export interface CharacterDialogueProfile {
  name: string
  role: string
  suggestions: readonly string[]
  placeholder: string
}

export const CHARACTER_DIALOGUE: Record<CharacterId, CharacterDialogueProfile> = {
  iris: {
    name: 'Iris',
    role: 'Reception',
    suggestions: [
      'What is happening right now?',
      'Who is on floor 45?',
      'Are there any incidents?',
      'Is anyone waiting?',
      'Is this connected to my computer?',
      'How do I reach floor 45?',
    ],
    placeholder: 'Ask Iris about the headquarters…',
  },
  mira: {
    name: 'Mira',
    role: 'Night Market Keeper',
    suggestions: [
      'What is this district?',
      'What do you sell?',
      'Where is headquarters?',
      'Who comes to the market?',
      'Is this connected to my computer?',
    ],
    placeholder: 'Ask Mira about the night market…',
  },
  kai: {
    name: 'Kai',
    role: 'Plaza Security',
    suggestions: [
      'What is this building?',
      'Can I go inside?',
      'What is on floor 45?',
      'Who are you keeping out?',
      'Can anything in here touch my computer?',
    ],
    placeholder: 'Ask Kai about the headquarters plaza…',
  },
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

/**
 * Plaza security.
 *
 * Kai is the one character whose job is the boundary itself, so the questions
 * about access get a straight answer rather than a deflection: this build has
 * no path to the machine it runs on, and saying so in the fiction is better
 * than leaving the player to wonder.
 */
function answerKai(question: string): Reply {
  const intent = classify(question)
  const grounded = (text: string): Reply => ({ source: 'grounded', text })
  const normalized = question.toLowerCase()

  // The boundary answer is checked before anything else on purpose. The
  // access phrasings below are broad, and "can anything in here touch my
  // computer" contains "in" — the security question must never lose a race to
  // a keyword match and come back as cheerful directions to the lift.
  if (intent === 'connection' || intent === 'model' || intent === 'cost') {
    return grounded(
      'Not a thing. This build has no route to your filesystem, your shell, or a model provider. I am scripted text in a web page, and so is everyone else here.',
    )
  }

  // Deliberately phrase-level, not word-level: bare "in" and "out" appear in
  // most English sentences and would swallow every other branch.
  if (/(go inside|come in|get in|let me in|can i enter|\benter\b|\baccess\b|\ballowed\b|\bbadge\b|\bpermission\b)/.test(normalized)) {
    return grounded(
      'Go right in. The doors open on approach, reception is Iris, and the lift at the back runs to floor 45. Nothing here is locked to you.',
    )
  }

  if (/(keeping out|keep out|\bguard(ing)?\b|\bsecurity\b|\bdanger\b|\bthreat\b|\bpatrol\b)/.test(normalized)) {
    return grounded(
      'Nothing dangerous, honestly. I watch the plaza, keep the lane clear of the traffic, and point people at the door. It is a quiet post.',
    )
  }

  if (/\b(building|tower|headquarters|hq|floor|45)\b/.test(normalized)) {
    return grounded(
      'That is headquarters — the teal-lit tower. Lobby at the bottom, operations on floor 45. The floors between are not built yet, and I will not pretend otherwise.',
    )
  }

  switch (intent) {
    case 'greeting':
      return grounded(
        'Evening. Kai, plaza security. Headquarters is straight through the doors behind me — mind the boulevard traffic on your way across.',
      )
    case 'overview':
    case 'navigate':
      return grounded(
        'Cross the plaza, the doors open by themselves, then talk to Iris at reception. The lift is at the back of the lobby; floor 45 is the one worth seeing.',
      )
    case 'agents':
    case 'tasks':
      return grounded(
        'The residents work upstairs on 45. Out here it is me, Mira down at the market, and people walking scripted routes.',
      )
    // 'connection', 'model' and 'cost' returned above, before the keyword
    // guards, so the boundary answer cannot lose a race to a phrase match.
    default:
      return grounded(
        'I mostly know this plaza. Ask me about getting inside, what is upstairs, or whether any of this touches your computer.',
      )
  }
}

function answerMira(question: string): Reply {
  const intent = classify(question)
  const grounded = (text: string): Reply => ({ source: 'grounded', text })
  const normalized = question.toLowerCase()

  if (/\b(district|boulevard|neighbou?rhood|city|market)\b/.test(normalized)) {
    return grounded(
      'This is Shenron City’s first playable neighborhood: Dragon Boulevard, the night market, Pocket Park, and the headquarters plaza.',
    )
  }

  if (/\b(sell|shop|stall|food|tea|ramen|flower|book)\b/.test(normalized)) {
    return grounded(
      'This lane is the night market: ramen, tea, flowers, and old books. My stall keeps the lamps on and the stories moving.',
    )
  }

  switch (intent) {
    case 'greeting':
      return grounded(
        'Welcome to Dragon Boulevard. I am Mira. The night market is open, and headquarters is the teal-lit tower at the end of the street.',
      )
    case 'overview':
      return grounded(
        'This is Shenron City’s first playable neighborhood: Dragon Boulevard, the night market, Pocket Park, and the headquarters plaza.',
      )
    case 'agents':
    case 'tasks':
      return grounded(
        'The people walking these blocks are local game characters following scripted routes. The fictional headquarters residents work on floor 45.',
      )
    case 'navigate':
      return grounded(
        'Follow the boulevard toward the tall teal-lit tower. Cross the plaza, enter the automatic doors, then take the lift to floor 45.',
      )
    case 'connection':
    case 'model':
    case 'cost':
      return grounded(
        'Nothing here connects to your computer or a model provider. I am a local scripted game character, and this district is bundled with the web game.',
      )
    case 'help':
      return grounded(
        'Ask me about the market, this district, the people walking around, or how to reach headquarters.',
      )
    case 'failures':
    case 'blocked':
      return grounded(
        'The street is calm tonight. For the fictional headquarters scenario, Iris at reception keeps the detailed status.',
      )
    case 'unknown':
      return {
        source: 'fallback',
        text: 'I only know this neighborhood and its local story for now. Ask me about the market, Dragon Boulevard, or headquarters.',
      }
  }
}

export function answerCharacter(
  characterId: CharacterId,
  question: string,
  snapshot: WorldSnapshot | null,
): Reply {
  if (characterId === 'mira') return answerMira(question)
  if (characterId === 'kai') return answerKai(question)
  return answer(question, snapshot)
}
