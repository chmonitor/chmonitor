/**
 * Read path for PeerDB AI insights.
 *
 * The PeerDB analog of `read-postgres-insights.ts`. PeerDB findings are
 * persisted in the SAME pluggable `InsightsStore`, partitioned under the
 * reserved host key `peerdbInsightStoreHostId(0)` (see `types.ts`) so they can
 * never be read back as a ClickHouse host or a Postgres source. Cards are
 * keyed with the engine-prefixed `insightKey(0, …, 'peerdb')` so dismissal
 * stays stable and distinct from every other engine. The findings store keeps
 * only scalars, so the action link is re-derived from the metric here.
 */

import type { FindingRow } from '../findings/findings-store'
import type { InsightAction, InsightCard, InsightSeverity } from './types'

import { resolveInsightsStore } from './store/resolve-store'
import { INSIGHT_SOURCES, insightKey, peerdbInsightStoreHostId } from './types'

/** PeerDB is a single deployment (one flow-api), so the source id is always 0 in v1. */
export const PEERDB_SOURCE_ID = 0

/** Default lookback for the panel — recent enough that insights stay relevant. */
const DEFAULT_SINCE = '6 HOUR'

const VALID_SEVERITY = new Set<InsightSeverity>(['info', 'warning', 'critical'])

/** Re-derive a sensible PeerDB action from the persisted metric/category. */
function derivePeerDBAction(
  metric: string,
  category: string
): InsightAction | undefined {
  switch (metric) {
    case 'peerdb_failed_mirrors':
    case 'peerdb_paused_mirrors':
    case 'peerdb_mirror_errors':
    case 'peerdb_snapshot_stalled':
      return { label: 'View mirrors', href: '/peerdb' }
    case 'peerdb_slot_lag_mb':
      return { label: 'View peers', href: '/peerdb/peers' }
    default:
      if (category === 'performance' || category === 'reliability')
        return { label: 'View mirrors', href: '/peerdb' }
      return undefined
  }
}

function toCard(row: FindingRow): InsightCard {
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
    action: derivePeerDBAction(row.metric, row.category),
    key: insightKey(PEERDB_SOURCE_ID, candidate, 'peerdb'),
    generatedAt: row.event_time,
  }
}

/**
 * Fetch the current set of PeerDB AI insights, de-duplicated by key (newest
 * wins) and ordered by severity then recency. Best-effort — returns `[]` on any
 * store failure.
 */
export async function readPeerDBInsights(
  opts: { since?: string; limit?: number } = {}
): Promise<InsightCard[]> {
  const since = opts.since ?? DEFAULT_SINCE
  const store = await resolveInsightsStore()
  const rows = await store.list(peerdbInsightStoreHostId(PEERDB_SOURCE_ID), {
    since,
    limit: opts.limit ?? 200,
  })

  const byKey = new Map<string, InsightCard>()
  for (const row of rows) {
    if (
      !INSIGHT_SOURCES.includes(row.source as (typeof INSIGHT_SOURCES)[number])
    )
      continue
    const card = toCard(row)
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
