/**
 * Host overage usage store — D1 persistence for the per-owner per-month PEAK
 * over-limit host count, metered into the monthly bill via `plan.hostOverage`
 * (`base + overageHosts * plan.hostOverage.usdPer`).
 *
 * Mirrors `ai-usage-store.ts`'s monthly spend accumulator: reads/writes degrade
 * gracefully. When the CHM_CLOUD_D1 binding is absent (local dev, self-host) or
 * the table doesn't exist yet, functions return safe defaults (0 / no-op) so
 * OSS/self-hosted deployments are never gated or metered.
 *
 * Schema: see src/db/conversations-migrations/0017_host_usage_monthly.sql
 */

import { periodKeyForOwner } from './period-key'
import { getPlatformBindings } from '@chm/platform'

function getDb() {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * Return the peak billable overage host count `ownerId` has recorded this
 * billing cycle. Keyed by {@link periodKeyForOwner} — the subscription's cycle
 * window when one is live, else the calendar UTC month. Returns 0 when D1 is
 * unavailable or no row exists yet.
 */
export async function getHostOverageThisMonth(
  ownerId: string,
  now: Date = new Date()
): Promise<number> {
  const db = getDb()
  if (!db) return 0
  try {
    const periodKey = await periodKeyForOwner(ownerId, now)
    const row = await db
      .prepare(
        `SELECT host_count FROM host_usage_monthly WHERE owner_id = ?1 AND month = ?2`
      )
      .bind(ownerId, periodKey)
      .first<{ host_count: number }>()
    return row?.host_count ?? 0
  } catch {
    return 0
  }
}

/**
 * Upsert `ownerId`'s PEAK billable overage host count for the billing cycle
 * (see {@link periodKeyForOwner}): `host_count = MAX(existing, overageHosts)`.
 * This is a PEAK meter, not additive — removing then re-adding a host within
 * the same cycle never multiplies the charge. Ignores non-positive/non-finite
 * counts. No-op when D1 is unavailable (self-hosted/OSS is never metered).
 */
export async function recordHostOverage(
  ownerId: string,
  overageHosts: number,
  now: Date = new Date()
): Promise<void> {
  if (!Number.isFinite(overageHosts) || overageHosts <= 0) return
  const db = getDb()
  if (!db) return
  try {
    const periodKey = await periodKeyForOwner(ownerId, now)
    const updatedAt = Math.floor(now.getTime() / 1000)
    await db
      .prepare(
        `INSERT INTO host_usage_monthly (owner_id, month, host_count, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner_id, month) DO UPDATE SET
           host_count = MAX(host_count, excluded.host_count),
           updated_at = excluded.updated_at`
      )
      .bind(ownerId, periodKey, overageHosts, updatedAt)
      .run()
  } catch {
    // Swallow: a missing table or transient D1 error must not break the request.
  }
}
