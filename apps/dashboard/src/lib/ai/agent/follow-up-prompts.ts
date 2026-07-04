import {
  STARTER_PROMPTS,
  type SuggestedPromptCategory,
} from './suggested-prompts'

const DEFAULT_LIMIT = 3
const FALLBACK_COUNT = 2

/**
 * A deterministic, rule-based follow-up suggestion set for one topic. Matched
 * by simple keyword lookup against the last exchange — no LLM call involved.
 */
interface FollowUpRule {
  readonly category: SuggestedPromptCategory
  readonly keywords: readonly string[]
  readonly prompts: readonly string[]
}

const FOLLOW_UP_RULES: readonly FollowUpRule[] = [
  {
    category: 'Performance',
    keywords: [
      'slow',
      'slowest',
      'performance',
      'latency',
      'query time',
      'duration',
    ],
    prompts: [
      'Explain the slowest one',
      'Show its EXPLAIN plan',
      'Compare to yesterday',
    ],
  },
  {
    category: 'Storage',
    keywords: ['table', 'storage', 'disk', 'partition', 'compression'],
    prompts: [
      'Show largest partitions',
      'Suggest a TTL',
      'Break down by column',
    ],
  },
  {
    category: 'Replication',
    keywords: ['replication', 'replica', 'zookeeper', 'keeper'],
    prompts: ['Show the replication queue', 'Which replica is behind?'],
  },
] as const

/**
 * Whether `keyword` appears in `haystack` as a whole word (optionally
 * pluralized with a trailing "s"), not merely as a substring — so "table"
 * doesn't match inside "notable"/"acceptable". Boundaries are "not a-z"
 * rather than regex `\b` so snake_case tool names (e.g.
 * `get_replication_queue`) still match on the underscore.
 */
function keywordMatches(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z])${escaped}s?(?:$|[^a-z])`).test(haystack)
}

export interface FollowUpPromptsInput {
  /** Text of the user's last message in the exchange. */
  readonly lastUserText?: string
  /** Text of the assistant's last reply in the exchange. */
  readonly lastAssistantText?: string
  /** Names of tools invoked while producing the last reply, if any. */
  readonly toolsUsed?: readonly string[]
  /** Max number of suggestions to return. */
  readonly limit?: number
}

/**
 * Derives 2-3 contextual next-step suggestions from the last chat exchange.
 *
 * Purely rule-based (keyword matching, no LLM call) so it is instant and
 * deterministic. Falls back to a couple of the existing STARTER_PROMPTS when
 * nothing in the exchange matches a known topic.
 */
export function getFollowUpPrompts({
  lastUserText = '',
  lastAssistantText = '',
  toolsUsed = [],
  limit = DEFAULT_LIMIT,
}: FollowUpPromptsInput = {}): string[] {
  const clampedLimit = Math.max(0, limit)
  if (clampedLimit === 0) return []

  const haystack = [lastUserText, lastAssistantText, ...toolsUsed]
    .join(' ')
    .toLowerCase()

  const matchedRule = FOLLOW_UP_RULES.find((rule) =>
    rule.keywords.some((keyword) => keywordMatches(haystack, keyword))
  )

  const prompts = matchedRule
    ? matchedRule.prompts
    : STARTER_PROMPTS.slice(0, FALLBACK_COUNT).map((prompt) => prompt.text)

  return prompts.slice(0, clampedLimit)
}
