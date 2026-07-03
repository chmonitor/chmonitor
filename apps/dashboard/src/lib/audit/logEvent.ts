/**
 * Audit log writer — best-effort append to the `audit_logs` D1 table.
 *
 * Enterprise-edition-gated (fails open to a no-op in community/self-hosted:
 * see lib/edition). Never throws into the caller: a missing D1 binding, an
 * unmigrated table, or any transient D1 error is caught and swallowed so a
 * logging failure can never block or roll back the underlying mutation.
 *
 * Schema: see src/db/conversations-migrations/0010_audit_logs.sql
 */

import { getPlatformBindings } from '@chm/platform'
import { isEnabled } from '@/lib/edition'

export interface AuditEvent {
  orgId: string
  userId?: string | null
  event: string
  resource?: string | null
  action: 'create' | 'update' | 'delete' | 'invite' | 'export' | string
  result: 'success' | 'denied' | 'error'
  ip?: string | null
  metadata?: Record<string, unknown>
}

const TABLE = 'audit_logs'

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * Append one immutable audit row.
 *
 * No-op (resolves immediately) when:
 * - the `audit` enterprise feature is disabled (community/self-hosted default)
 * - `orgId` is missing/empty — org scoping is mandatory, never log an
 *   unscoped row
 * - the CHM_CLOUD_D1 binding is unavailable (local dev / self-host)
 *
 * Never throws: a D1 write failure is caught and swallowed — audit is
 * observational, not a gate, matching the same fail-open convention as
 * lib/billing/ai-usage-store.ts / lib/insights/baseline-store.ts.
 *
 * @param opts.runtimeEnv Optional edition-resolution override (Cloudflare
 *   Worker `env` binding or a test fixture), forwarded to `isEnabled`. Omit to
 *   resolve from `process.env` / build-time `VITE_EDITION` as usual.
 */
export async function logEvent(
  e: AuditEvent,
  opts?: { runtimeEnv?: Record<string, string | undefined> }
): Promise<void> {
  if (!isEnabled('audit', opts?.runtimeEnv)) return
  if (!e.orgId) return

  const db = getDb()
  if (!db) return

  try {
    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (id, event_time, org_id, user_id, event, resource, action, result, ip, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        e.orgId,
        e.userId ?? null,
        e.event,
        e.resource ?? null,
        e.action,
        e.result,
        e.ip ?? null,
        e.metadata ? JSON.stringify(e.metadata) : null
      )
      .run()
  } catch {
    // Swallow: audit is best-effort and must never break the caller's request.
  }
}
