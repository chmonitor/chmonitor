/**
 * Read path for Postgres AI insights.
 *
 * The Postgres analog of `read-insights.ts`. Postgres findings are persisted in
 * the SAME pluggable `InsightsStore`, partitioned under the reserved host key
 * `pgInsightStoreHostId(pgHostId)` (see `types.ts`) so they can never be read
 * back as a ClickHouse host. Cards are keyed with the engine-prefixed
 * `insightKey(pgHostId, …, 'postgres')` so dismissal stays stable and distinct
 * from ClickHouse. The findings store keeps only scalars, so the action link is
 * re-derived from the metric here.
 */

import type { FindingRow } from '../findings/findings-store'
import type { InsightAction, InsightCard, InsightSeverity } from './types'

import { resolveInsightsStore } from './store/resolve-store'
import { INSIGHT_SOURCES, insightKey, pgInsightStoreHostId } from './types'

/** Default lookback for the panel — recent enough that insights stay relevant. */
const DEFAULT_SINCE = '6 HOUR'

const VALID_SEVERITY = new Set<InsightSeverity>(['info', 'warning', 'critical'])

/** Re-derive a sensible Postgres action from the persisted metric/category. */
function derivePostgresAction(
  metric: string,
  category: string
): InsightAction | undefined {
  switch (metric) {
    case 'pg_connection_saturation':
    case 'pg_long_running_query':
    case 'pg_idle_in_transaction':
    case 'pg_dead_tuple_ratio':
    case 'pg_replication_lag':
    case 'pg_rollbacks_deadlocks':
      return { label: 'View activity', href: '/postgres/activity' }
    case 'pg_cache_hit_ratio':
    case 'pg_stat_statements_missing':
    case 'pg_unused_indexes':
      return { label: 'View queries', href: '/postgres/queries' }
    default:
      if (category === 'performance' || category === 'optimization')
        return { label: 'View queries', href: '/postgres/queries' }
      return { label: 'View activity', href: '/postgres/activity' }
  }
}

function toCard(pgHostId: number, row: FindingRow): InsightCard {
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
    action: derivePostgresAction(row.metric, row.category),
    key: insightKey(pgHostId, candidate, 'postgres'),
    generatedAt: row.event_time,
  }
}

/**
 * Fetch the current set of Postgres AI insights for one source, de-duplicated by
 * key (newest wins) and ordered by severity then recency. Best-effort — returns
 * `[]` on any store failure.
 */
export async function readPostgresInsights(
  pgHostId: number,
  opts: { since?: string; limit?: number } = {}
): Promise<InsightCard[]> {
  const since = opts.since ?? DEFAULT_SINCE
  const store = await resolveInsightsStore()
  const rows = await store.list(pgInsightStoreHostId(pgHostId), {
    since,
    limit: opts.limit ?? 200,
  })

  const byKey = new Map<string, InsightCard>()
  for (const row of rows) {
    if (
      !INSIGHT_SOURCES.includes(row.source as (typeof INSIGHT_SOURCES)[number])
    )
      continue
    const card = toCard(pgHostId, row)
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
