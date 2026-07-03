/**
 * Read path for the audit export route.
 *
 * `AUDIT_EXPORT_SELECT_SQL` is exported so query.sql.test.ts can run the exact
 * production SQL string against a real SQLite database (bun:sqlite — D1's
 * underlying engine) and prove the `org_id = ?1` predicate actually isolates
 * rows, rather than trusting a hand-rolled fake that could drift from the
 * real query.
 */

import { getPlatformBindings } from '@chm/platform'

export interface AuditLogRow {
  event_time: string
  user_id: string | null
  event: string
  resource: string | null
  action: string
  result: string
  ip: string | null
}

/**
 * Org-scoped, date-ranged read of audit_logs. `orgId` MUST be session-derived
 * by the caller — never taken from a request query param (see
 * routes/api/v1/audit/export.ts and plans/22-audit-log-export.md's STOP
 * condition on org scoping).
 */
export const AUDIT_EXPORT_SELECT_SQL = `
  SELECT event_time, user_id, event, resource, action, result, ip
  FROM audit_logs
  WHERE org_id = ?1 AND event_time >= ?2 AND event_time <= ?3
  ORDER BY event_time DESC
`

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * List audit rows for `orgId` within `[fromIso, toIso]` (inclusive,
 * ISO-8601 UTC strings). Returns `[]` when D1 is unavailable or the read
 * fails — the export route treats that as "no rows" rather than an error,
 * since audit is observational and a D1 blip must not break the export.
 */
export async function listAuditLogs(
  orgId: string,
  fromIso: string,
  toIso: string
): Promise<AuditLogRow[]> {
  const db = getDb()
  if (!db) return []

  try {
    const result = await db
      .prepare(AUDIT_EXPORT_SELECT_SQL)
      .bind(orgId, fromIso, toIso)
      .all<AuditLogRow>()
    return result.results ?? []
  } catch {
    return []
  }
}
