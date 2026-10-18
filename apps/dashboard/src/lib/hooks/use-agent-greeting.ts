import { useMemo } from 'react'

type GreetingTone = 'default' | 'alert'

export interface AgentGreeting {
  heading: string
  tone: GreetingTone
}

function partOfDay(date: Date): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = date.getHours()
  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}

export interface AgentGreetingInput {
  firstName?: string | null
  hasClusterIssue?: boolean
  clusterName?: string | null
  /** Override the clock for tests. */
  now?: Date
}

export function buildAgentGreeting(input: AgentGreetingInput): AgentGreeting {
  const now = input.now ?? new Date()
  const name = input.firstName?.trim() ?? ''

  if (input.hasClusterIssue) {
    const who = name ? `, ${name}` : ''
    return {
      tone: 'alert',
      heading: `Something needs a look${who}.`,
    }
  }

  const part = partOfDay(now)
  const niceName = name ? `, ${name}` : ''

  switch (part) {
    case 'morning':
      return {
        tone: 'default',
        heading: `Good morning${niceName} — what should we look at?`,
      }
    case 'afternoon':
      return {
        tone: 'default',
        heading: `Good afternoon${niceName} — how can I help?`,
      }
    case 'evening':
      return {
        tone: 'default',
        heading: `Good evening${niceName} — what can I dig into?`,
      }
    case 'night':
      return {
        tone: 'default',
        heading: name
          ? `Still up, ${name}? Let's take a look.`
          : 'Still up? Let’s take a look.',
      }
  }
}

export function useAgentGreeting(input: AgentGreetingInput): AgentGreeting {
  const { firstName, hasClusterIssue, clusterName } = input
  return useMemo(
    () =>
      buildAgentGreeting({
        firstName,
        hasClusterIssue,
        clusterName,
      }),
    [firstName, hasClusterIssue, clusterName]
  )
}
