/**
 * Unread table / unused projection insight collector (#4067, slice 4).
 *
 * Reads `system.query_log` (this host only: it is per replica),
 * `system.tables`, `system.projections` and `system.projection_parts`.
 * Thresholds and mapping live in `usage-classifier.ts`, the SQL in
 * `usage-findings-sql.ts`. Unread columns are not collected: they are
 * per-table and misleading without a table choice. Fails open: a missing
 * query_log or projections table, or any error, yields no insight.
 */

import type { InsightCandidate } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import {
  insightFromUnreadTableRows,
  insightFromUnusedProjectionRows,
  USAGE_MIN_BYTES,
} from './usage-classifier'
import {
  USAGE_FINDINGS_SETTINGS,
  unreadTablesSql,
  unusedProjectionsSql,
} from './usage-findings-sql'

const USAGE_COLLECTOR_LIMIT = 5

export const usageUnreadTablesSql = unreadTablesSql({
  minBytes: USAGE_MIN_BYTES,
  limit: USAGE_COLLECTOR_LIMIT,
})

export const usageUnusedProjectionsSql = unusedProjectionsSql({
  minBytes: USAGE_MIN_BYTES,
  limit: USAGE_COLLECTOR_LIMIT,
})

async function run(
  hostId: number,
  query: string,
  toInsights: (rows: unknown) => InsightCandidate[]
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query,
      hostId,
      clickhouse_settings: USAGE_FINDINGS_SETTINGS,
    })
    return toInsights(rows)
  } catch {
    return []
  }
}

/**
 * Two independent queries: a server without `system.projections` must still
 * report its unread table, and the reverse.
 */
export async function collectUsage(
  hostId: number
): Promise<InsightCandidate[]> {
  const [tables, projections] = await Promise.all([
    run(hostId, usageUnreadTablesSql, insightFromUnreadTableRows),
    run(hostId, usageUnusedProjectionsSql, insightFromUnusedProjectionRows),
  ])
  return [...tables, ...projections]
}
