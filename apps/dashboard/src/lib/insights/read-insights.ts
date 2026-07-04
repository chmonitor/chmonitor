/**
 * Read path for AI insights.
 *
 * Reads `ai-insight` rows from the findings store and maps them to insight
 * cards for the overview panel. Because the cron sweep re-inserts insights every
 * few minutes, rows are de-duplicated by their stable key (newest wins) and
 * bounded to a recent window so a problem that has since resolved does not
 * linger in the panel. The findings table stores only scalars, so the
 * recommended action is re-derived from the metric/category here.
 */

import type { FindingRow } from '../findings/findings-store'
import type { InsightAction, InsightCard, InsightSeverity } from './types'

import { resolveInsightsStore } from './store/resolve-store'
import { INSIGHT_SOURCES, insightKey } from './types'

/** Default lookback for the panel — recent enough that insights stay relevant. */
const DEFAULT_SINCE = '6 HOUR'

const VALID_SEVERITY = new Set<InsightSeverity>(['info', 'warning', 'critical'])

/** Re-derive a sensible action from the persisted metric/category. */
function deriveAction(
  metric: string,
  category: string
): InsightAction | undefined {
  switch (metric) {
    case 'error_rate':
    case 'query_duration_p95':
    case 'memory_usage':
      return { label: 'Open running queries', href: '/running-queries' }
    case 'max_active_parts':
    case 'worst_compression_ratio':
    case 'detached_parts':
      return { label: 'View tables', href: '/tables' }
    case 'readonly_replicas':
    case 'max_replication_delay':
      return { label: 'View replicas', href: '/replicas' }
    case 'stuck_mutations':
      return { label: 'View mutations', href: '/mutations' }
    case 'longest_running_query':
      return { label: 'Open running queries', href: '/running-queries' }
    case 'failed_dictionaries':
      return { label: 'View dictionaries', href: '/dictionaries' }
    default:
      if (category === 'storage')
        return { label: 'View tables', href: '/tables' }
      // Schema-optimization suggestions use a dynamic per-recommendation metric
      // (`schema_opt:...`), so they never match a case above. Re-derive a
      // generic agent deep-link — the specific DDL/rewrite only lives in the
      // immediate generate() response (scalar findings store drops it).
      if (category === 'optimization')
        return {
          label: 'Ask the agent',
          prompt:
            'Review this schema optimization suggestion and show the DDL or rewrite to apply, with its estimated impact and risk.',
        }
      return undefined
  }
}

function toCard(hostId: number, row: FindingRow): InsightCard {
  const severity = (
    VALID_SEVERITY.has(row.severity as InsightSeverity) ? row.severity : 'info'
  ) as InsightSeverity

  const candidate = {
    category: row.category,
    metric: row.metric || undefined,
    title: row.title,
  }

  return {
    severity,
    category: row.category,
    title: row.title,
    detail: row.detail,
    metric: row.metric || undefined,
    value: row.value,
    action: deriveAction(row.metric, row.category),
    key: insightKey(hostId, candidate),
    generatedAt: row.event_time,
  }
}

/**
 * Fetch the current set of AI insights for a host, de-duplicated by key
 * (newest occurrence wins) and ordered by severity then recency.
 */
export async function readInsights(
  hostId: number,
  opts: { since?: string; limit?: number } = {}
): Promise<InsightCard[]> {
  const since = opts.since ?? DEFAULT_SINCE
  const store = await resolveInsightsStore()
  const rows = await store.list(hostId, {
    since,
    limit: opts.limit ?? 200,
  })

  // listRecentFindings returns newest-first; keep the first row seen per key.
  const byKey = new Map<string, InsightCard>()
  for (const row of rows) {
    if (
      !INSIGHT_SOURCES.includes(row.source as (typeof INSIGHT_SOURCES)[number])
    )
      continue
    const card = toCard(hostId, row)
    if (!byKey.has(card.key)) byKey.set(card.key, card)
  }

  const rank: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  return [...byKey.values()].sort((a, b) => {
    const bySeverity = rank[a.severity] - rank[b.severity]
    if (bySeverity !== 0) return bySeverity
    return (b.generatedAt ?? '').localeCompare(a.generatedAt ?? '')
  })
}
