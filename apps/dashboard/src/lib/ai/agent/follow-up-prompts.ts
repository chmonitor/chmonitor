import {
  STARTER_PROMPTS,
  type SuggestedPromptCategory,
} from './suggested-prompts'

const DEFAULT_LIMIT = 3
const FALLBACK_COUNT = 2

/**
 * A candidate next-step suggestion.
 *
 * `relatedTool` names the agent tool that clicking this suggestion would most
 * likely trigger. When that tool is already present in `toolsUsed` for the
 * current exchange, the candidate is dropped — its answer was already
 * surfaced this turn, so resurfacing the same question is noise. Candidates
 * that are still useful even after a repeat call (e.g. "look at a different
 * column") omit `relatedTool` and are never filtered this way.
 */
interface FollowUpCandidate {
  readonly text: string
  readonly relatedTool?: string
}

/**
 * Next-step suggestions keyed by the agent tool that was just used to answer
 * the current turn. This is the primary, high-precision signal: the exact
 * tool call tells us exactly what the user already saw, so suggestions here
 * are genuinely different follow-on investigations rather than a restatement
 * of the same data. Only tools that commonly end a turn (i.e. the ones a user
 * would naturally want to drill into further) are mapped; internal-only tools
 * (`ask_user`, `update_plan`, `load_skill`) and destructive control tools
 * (`kill_query`, `optimize_table`, `kill_mutation`) are intentionally
 * excluded — the latter should never be nudged via a passive suggestion chip.
 */
const TOOL_FOLLOW_UPS: Readonly<Record<string, readonly FollowUpCandidate[]>> =
  {
    // Query / performance
    get_running_queries: [
      { text: "Explain the top query's plan", relatedTool: 'explain_query' },
      {
        text: 'Check for repeating slow patterns',
        relatedTool: 'list_slow_query_patterns',
      },
      { text: 'Look at overall cluster health', relatedTool: 'get_metrics' },
    ],
    get_slow_queries: [
      {
        text: "Explain the slowest query's plan",
        relatedTool: 'explain_query',
      },
      { text: 'Estimate its cost', relatedTool: 'estimate_query_cost' },
      {
        text: 'Check for repeating slow patterns',
        relatedTool: 'list_slow_query_patterns',
      },
    ],
    list_slow_query_patterns: [
      {
        text: 'Get tuning suggestions for the worst pattern',
        relatedTool: 'get_tuning_suggestions',
      },
      {
        text: "Explain the top pattern's plan",
        relatedTool: 'explain_query',
      },
      {
        text: 'Check currently running queries',
        relatedTool: 'get_running_queries',
      },
    ],
    get_failed_queries: [
      { text: 'Explain why the top one failed', relatedTool: 'explain_query' },
      {
        text: 'Check currently running queries',
        relatedTool: 'get_running_queries',
      },
      { text: 'Look at overall cluster health', relatedTool: 'get_metrics' },
    ],
    explain_query: [
      { text: 'Estimate its cost', relatedTool: 'estimate_query_cost' },
      { text: 'Get tuning suggestions', relatedTool: 'get_tuning_suggestions' },
      {
        text: 'Get optimization recommendations',
        relatedTool: 'get_optimization_recommendations',
      },
    ],
    estimate_query_cost: [
      {
        text: 'Get tuning suggestions to reduce it',
        relatedTool: 'get_tuning_suggestions',
      },
      { text: 'Show its EXPLAIN plan', relatedTool: 'explain_query' },
    ],
    query_and_visualize: [
      { text: 'Break it down by another column' },
      { text: 'Turn this into a dashboard', relatedTool: 'suggest_dashboard' },
    ],

    // Storage
    get_table_parts: [
      {
        text: 'Suggest a TTL for this table',
        relatedTool: 'suggest_ttl_adjustment',
      },
      {
        text: 'Forecast when disk fills up',
        relatedTool: 'forecast_disk_capacity',
      },
      { text: 'Check current merge activity', relatedTool: 'get_merge_status' },
    ],
    forecast_disk_capacity: [
      {
        text: 'Suggest a TTL to slow growth',
        relatedTool: 'suggest_ttl_adjustment',
      },
      {
        text: 'Show which tables use the most space',
        relatedTool: 'get_table_parts',
      },
    ],
    suggest_ttl_adjustment: [
      {
        text: 'Estimate the mutation impact',
        relatedTool: 'estimate_mutation_impact',
      },
      {
        text: 'Forecast disk capacity after the change',
        relatedTool: 'forecast_disk_capacity',
      },
    ],
    estimate_mutation_impact: [
      { text: 'Check current merge activity', relatedTool: 'get_merge_status' },
      { text: 'Review disk headroom', relatedTool: 'get_disk_usage' },
    ],

    // Replication / merges
    get_replication_status: [
      {
        text: 'Check for a merge backlog on that table',
        relatedTool: 'get_merge_status',
      },
      { text: 'Look at overall cluster health', relatedTool: 'get_metrics' },
      {
        text: 'Get tuning suggestions for the lagging table',
        relatedTool: 'get_tuning_suggestions',
      },
    ],
    get_merge_status: [
      { text: 'Check disk headroom', relatedTool: 'get_disk_usage' },
      {
        text: 'Suggest a TTL to reduce merge pressure',
        relatedTool: 'suggest_ttl_adjustment',
      },
      {
        text: 'Look at replication status',
        relatedTool: 'get_replication_status',
      },
    ],

    // Health
    get_metrics: [
      { text: 'Check disk usage', relatedTool: 'get_disk_usage' },
      {
        text: 'Check replication status',
        relatedTool: 'get_replication_status',
      },
      {
        text: 'See currently running queries',
        relatedTool: 'get_running_queries',
      },
    ],
    get_disk_usage: [
      {
        text: 'Forecast when disk fills up',
        relatedTool: 'forecast_disk_capacity',
      },
      {
        text: 'Show which tables use the most space',
        relatedTool: 'get_table_parts',
      },
      {
        text: 'Suggest a TTL to reclaim space',
        relatedTool: 'suggest_ttl_adjustment',
      },
    ],

    // Schema
    list_tables: [
      { text: 'Show the largest tables', relatedTool: 'get_table_parts' },
      { text: 'Explore a table schema', relatedTool: 'explore_table_schema' },
    ],
    get_table_schema: [
      {
        text: 'Recommend a materialized view for it',
        relatedTool: 'recommend_materialized_view',
      },
      { text: 'Show its largest partitions', relatedTool: 'get_table_parts' },
      {
        text: 'Get optimization recommendations',
        relatedTool: 'get_optimization_recommendations',
      },
    ],
    explore_table_schema: [
      {
        text: 'Recommend a materialized view for it',
        relatedTool: 'recommend_materialized_view',
      },
      { text: 'Show its largest partitions', relatedTool: 'get_table_parts' },
      {
        text: 'Get optimization recommendations',
        relatedTool: 'get_optimization_recommendations',
      },
    ],

    // Advisor
    get_optimization_recommendations: [
      {
        text: 'Get more detailed tuning suggestions',
        relatedTool: 'get_tuning_suggestions',
      },
      {
        text: 'Estimate the impact on a running mutation',
        relatedTool: 'estimate_mutation_impact',
      },
    ],
    get_tuning_suggestions: [
      { text: "Show the query's EXPLAIN plan", relatedTool: 'explain_query' },
      {
        text: 'Get broader optimization recommendations',
        relatedTool: 'get_optimization_recommendations',
      },
    ],

    // MV designer / insight / report / dashboard
    recommend_materialized_view: [
      {
        text: 'Estimate the mutation impact',
        relatedTool: 'estimate_mutation_impact',
      },
      { text: 'Check the table schema', relatedTool: 'get_table_schema' },
    ],
    explain_anomaly_score: [
      {
        text: 'Check currently running queries',
        relatedTool: 'get_running_queries',
      },
      { text: 'Look at overall cluster health', relatedTool: 'get_metrics' },
    ],
    generate_cluster_report: [
      { text: 'Check disk usage', relatedTool: 'get_disk_usage' },
      {
        text: 'Check replication status',
        relatedTool: 'get_replication_status',
      },
    ],
    suggest_dashboard: [
      {
        text: 'Visualize one of these metrics',
        relatedTool: 'query_and_visualize',
      },
    ],

    // Postgres (only reachable when CHM_FEATURE_POSTGRES_SOURCE is enabled)
    run_postgres_select_query: [
      {
        text: 'Check Postgres table stats',
        relatedTool: 'get_postgres_table_stats',
      },
    ],
    list_postgres_slow_query_patterns: [
      { text: 'Check Postgres metrics', relatedTool: 'get_postgres_metrics' },
    ],
    get_postgres_metrics: [
      {
        text: 'Check Postgres table stats',
        relatedTool: 'get_postgres_table_stats',
      },
    ],
    get_postgres_table_stats: [
      { text: 'Check Postgres metrics', relatedTool: 'get_postgres_metrics' },
    ],
  }

/**
 * Fallback rules matched by keyword when no exchange tool call maps to
 * {@link TOOL_FOLLOW_UPS} (e.g. the assistant answered from general
 * knowledge without calling a tool). Less precise than the tool-driven path,
 * so it is only consulted as a second choice.
 */
interface FollowUpRule {
  readonly category: SuggestedPromptCategory
  readonly keywords: readonly string[]
  readonly prompts: readonly FollowUpCandidate[]
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
      {
        text: "Explain the slowest query's plan",
        relatedTool: 'explain_query',
      },
      { text: 'Estimate its cost', relatedTool: 'estimate_query_cost' },
      {
        text: 'Check for repeating slow patterns',
        relatedTool: 'list_slow_query_patterns',
      },
    ],
  },
  {
    category: 'Storage',
    keywords: ['table', 'storage', 'disk', 'partition', 'compression'],
    prompts: [
      { text: 'Show largest partitions', relatedTool: 'get_table_parts' },
      { text: 'Suggest a TTL', relatedTool: 'suggest_ttl_adjustment' },
      {
        text: 'Forecast when disk fills up',
        relatedTool: 'forecast_disk_capacity',
      },
    ],
  },
  {
    category: 'Replication',
    keywords: ['replication', 'replica', 'zookeeper', 'keeper'],
    prompts: [
      {
        text: 'Show the replication queue',
        relatedTool: 'get_replication_status',
      },
      {
        text: 'Which replica is behind?',
        relatedTool: 'get_replication_status',
      },
      { text: 'Check for a merge backlog', relatedTool: 'get_merge_status' },
    ],
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

/**
 * Picks the rule whose keywords match `haystack` the most, not just the
 * first rule with any match — a reply about replication that happens to
 * mention "table" (e.g. "per-table replication queue") must still route to
 * Replication, not fall into Storage because it's declared earlier in
 * {@link FOLLOW_UP_RULES}. Ties keep the earlier-declared rule.
 */
function matchBestRule(haystack: string): FollowUpRule | undefined {
  let best: { rule: FollowUpRule; score: number } | undefined

  for (const rule of FOLLOW_UP_RULES) {
    const score = rule.keywords.reduce(
      (count, keyword) => count + (keywordMatches(haystack, keyword) ? 1 : 0),
      0
    )
    if (score > 0 && (!best || score > best.score)) {
      best = { rule, score }
    }
  }

  return best?.rule
}

/** Case/whitespace-insensitive dedupe key for a suggestion's text. */
function dedupeKey(text: string): string {
  return text.trim().toLowerCase()
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
 * Derives up to `limit` contextual next-step suggestions from the last chat
 * exchange.
 *
 * Purely rule-based (tool-name + keyword matching, no LLM call) so it is
 * instant and deterministic. Prefers the tools actually invoked to answer the
 * turn — the most precise signal for "what does the user already know" — and
 * falls back to keyword matching on the exchange text, then to a couple of
 * the generic {@link STARTER_PROMPTS} when nothing matches.
 *
 * A candidate is dropped whenever its `relatedTool` was itself already called
 * this turn: that tool's output already answers the suggestion, so
 * resurfacing it would just repeat what the agent just said.
 */
export function getFollowUpPrompts({
  lastUserText = '',
  lastAssistantText = '',
  toolsUsed = [],
  limit = DEFAULT_LIMIT,
}: FollowUpPromptsInput = {}): string[] {
  const clampedLimit = Math.max(0, limit)
  if (clampedLimit === 0) return []

  const usedTools = new Set(toolsUsed)

  // Prefer the most recently called tool's suggestions first, so the chips
  // track what the agent JUST did rather than the first tool of the turn.
  const uniqueToolsMostRecentFirst = [...new Set([...toolsUsed].reverse())]

  const toolCandidates = uniqueToolsMostRecentFirst.flatMap(
    (tool) => TOOL_FOLLOW_UPS[tool] ?? []
  )

  let candidates: readonly FollowUpCandidate[] = toolCandidates

  if (candidates.length === 0) {
    const haystack = [lastUserText, lastAssistantText, ...toolsUsed]
      .join(' ')
      .toLowerCase()

    const matchedRule = matchBestRule(haystack)

    candidates = matchedRule ? matchedRule.prompts : []
  }

  const seen = new Set<string>()
  const filtered: string[] = []

  for (const candidate of candidates) {
    if (candidate.relatedTool && usedTools.has(candidate.relatedTool)) continue

    const key = dedupeKey(candidate.text)
    if (seen.has(key)) continue

    seen.add(key)
    filtered.push(candidate.text)
    if (filtered.length === clampedLimit) break
  }

  if (filtered.length > 0) return filtered

  return STARTER_PROMPTS.slice(0, FALLBACK_COUNT)
    .map((prompt) => prompt.text)
    .slice(0, clampedLimit)
}
