import type { UIMessage } from 'ai'

const RECENT_MESSAGE_COUNT = 8
const MIN_CONTEXT_TOKEN_LENGTH = 3
const DEFAULT_PROMPT_LIMIT = 3

export type SuggestedPromptCategory =
  | 'Insights'
  | 'Performance'
  | 'Storage'
  | 'Schema'
  | 'System'
  | 'Replication'
  | 'Operations'
  | 'Access'

/**
 * Immutable prompt suggestion shown in empty states and the agent sidebar.
 *
 * `text` is submitted to chat, `category` groups the prompt for UI context,
 * and `tags` are matched against recent conversation text for ranking.
 */
export interface SuggestedPrompt {
  readonly text: string
  readonly category: SuggestedPromptCategory
  readonly tags: readonly string[]
}

export const STARTER_PROMPTS: readonly SuggestedPrompt[] = [
  {
    text: "What's the largest data scan ever performed on this cluster?",
    category: 'Insights',
    tags: ['insight', 'scan', 'largest'],
  },
  {
    text: 'What databases are available and which ones have the most tables?',
    category: 'Schema',
    tags: ['database', 'schema', 'tables'],
  },
  {
    text: 'Show me the 10 largest tables and their disk usage',
    category: 'Storage',
    tags: ['table', 'storage', 'disk', 'largest'],
  },
  {
    text: 'Which queries are running right now and how long have they been executing?',
    category: 'Performance',
    tags: ['running', 'query', 'duration'],
  },
  {
    text: 'What are the slowest queries from the past 24 hours?',
    category: 'Performance',
    tags: ['slow', 'query', 'performance'],
  },
  {
    text: 'Show me failed queries from the last hour',
    category: 'Performance',
    tags: ['failed', 'query', 'error'],
  },
  {
    text: 'How is the merge queue performing? Are there any large merges stuck?',
    category: 'Operations',
    tags: ['merge', 'queue', 'stuck'],
  },
  {
    text: 'What is the current CPU, memory, and disk usage of this server?',
    category: 'System',
    tags: ['cpu', 'memory', 'disk', 'system'],
  },
  {
    text: 'Show me replication lag across all replica tables',
    category: 'Replication',
    tags: ['replication', 'lag', 'replica'],
  },
  {
    text: 'Are there any stuck mutations?',
    category: 'Operations',
    tags: ['mutation', 'stuck'],
  },
  {
    text: 'Which users are consuming the most resources?',
    category: 'Access',
    tags: ['user', 'resources', 'access'],
  },
  {
    text: 'What server settings have been changed from defaults?',
    category: 'System',
    tags: ['settings', 'defaults', 'server'],
  },
] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function messageText(message: UIMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : []

  return parts
    .map((part) =>
      isObject(part) && part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : ''
    )
    .join(' ')
}

function contextTokens(messages: readonly UIMessage[]): Set<string> {
  const text = messages
    .slice(-RECENT_MESSAGE_COUNT)
    .map(messageText)
    .join(' ')
    .toLowerCase()
  const tokens = new Set<string>()

  for (const word of text.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length >= MIN_CONTEXT_TOKEN_LENGTH) tokens.add(word)
  }

  return tokens
}

/**
 * Returns starter prompts ranked by recent conversation context.
 *
 * @returns Up to `limit` prompt suggestions, keeping stable starter order for
 * equally relevant prompts.
 */
export function getSuggestedPrompts({
  messages = [],
  limit = DEFAULT_PROMPT_LIMIT,
}: {
  readonly messages?: readonly UIMessage[]
  readonly limit?: number
} = {}): SuggestedPrompt[] {
  const tokens = contextTokens(messages)

  return [...STARTER_PROMPTS]
    .map((prompt, index) => {
      const score =
        prompt.tags.reduce(
          (sum, tag) => sum + (tokens.has(tag.toLowerCase()) ? 2 : 0),
          0
        ) + (tokens.has(prompt.category.toLowerCase()) ? 1 : 0)

      return { prompt, score, index }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((item) => item.prompt)
}
