/**
 * AI daily usage store — D1 persistence for the per-owner per-day AI request
 * counter consumed by the plan-enforcement gate in the agent route.
 *
 * Reads and writes degrade gracefully: when the CHM_CLOUD_D1 binding is absent
 * (local dev, self-host) or the table does not yet exist, functions return safe
 * defaults (0 / no-op) so OSS deployments are never gated.
 *
 * Schema: see src/db/conversations-migrations/0005_ai_usage_daily.sql
 */

import type { Plan } from './plans'

import { periodKeyForOwner, utcMonthKey } from './period-key'
import { getPlatformBindings } from '@chm/platform'

/** Returns the UTC date string 'YYYY-MM-DD' for the given instant. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// Re-exported for existing call-sites — see period-key.ts for the
// subscription-cycle-aware key that now drives the monthly meters below.
export { utcMonthKey }

function getDb() {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/**
 * Return how many AI requests `ownerId` has made today (UTC).
 * Returns 0 when D1 is unavailable or no row exists yet.
 */
export async function getAiUsageToday(
  ownerId: string,
  now: Date = new Date()
): Promise<number> {
  const db = getDb()
  if (!db) return 0
  try {
    const row = await db
      .prepare(
        `SELECT count FROM ai_usage_daily WHERE owner_id = ?1 AND day = ?2`
      )
      .bind(ownerId, utcDayKey(now))
      .first<{ count: number }>()
    return row?.count ?? 0
  } catch {
    return 0
  }
}

/**
 * Atomically increment `ownerId`'s request count for today (UTC).
 * No-op when D1 is unavailable.
 */
export async function incrementAiUsage(
  ownerId: string,
  now: Date = new Date()
): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    const updatedAt = Math.floor(now.getTime() / 1000)
    await db
      .prepare(
        `INSERT INTO ai_usage_daily (owner_id, day, count, updated_at)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(owner_id, day) DO UPDATE SET
           count      = count + 1,
           updated_at = excluded.updated_at`
      )
      .bind(ownerId, utcDayKey(now), updatedAt)
      .run()
  } catch {
    // Swallow: a missing table or transient D1 error must not break the request.
  }
}

/**
 * Atomically reserve one AI request for `ownerId` today (UTC) and return the
 * resulting post-increment count. The single INSERT … ON CONFLICT … RETURNING
 * statement makes the read+increment atomic, closing the check-then-increment
 * race where two concurrent requests could both pass the daily gate.
 *
 * Returns null when D1 is unavailable (local dev / self-host) so callers skip
 * gating — the "self-hosted stays whole" invariant. A caller that finds the
 * reservation exceeds the plan cap should immediately {@link releaseAiUsage} it.
 */
export async function reserveAiUsage(
  ownerId: string,
  now: Date = new Date()
): Promise<number | null> {
  const db = getDb()
  if (!db) return null
  try {
    const updatedAt = Math.floor(now.getTime() / 1000)
    const row = await db
      .prepare(
        `INSERT INTO ai_usage_daily (owner_id, day, count, updated_at)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(owner_id, day) DO UPDATE SET
           count      = count + 1,
           updated_at = excluded.updated_at
         RETURNING count`
      )
      .bind(ownerId, utcDayKey(now), updatedAt)
      .first<{ count: number }>()
    return row?.count ?? null
  } catch {
    return null
  }
}

/**
 * Release one previously reserved AI request for `ownerId` today (UTC). Used to
 * roll back an over-limit reservation or a generation that failed before it
 * started, so aborted requests never consume the user's quota. Never drops the
 * counter below zero. No-op when D1 is unavailable.
 */
export async function releaseAiUsage(
  ownerId: string,
  now: Date = new Date()
): Promise<void> {
  const db = getDb()
  if (!db) return
  try {
    const updatedAt = Math.floor(now.getTime() / 1000)
    await db
      .prepare(
        `UPDATE ai_usage_daily
            SET count      = MAX(0, count - 1),
                updated_at = ?3
          WHERE owner_id = ?1 AND day = ?2`
      )
      .bind(ownerId, utcDayKey(now), updatedAt)
      .run()
  } catch {
    // Swallow: a rollback failure must not break the request.
  }
}

// ---------------------------------------------------------------------------
// Monthly LLM spend accumulator (per-owner USD, cloud SaaS only)
// ---------------------------------------------------------------------------

/**
 * Lazily ensure the monthly-spend table exists. Cached per worker instance so
 * the DDL runs at most once. Mirrors the daily counter but keyed by UTC month
 * and stores fractional USD (REAL). Kept in the store (not a migration) so this
 * accumulator degrades gracefully everywhere the daily counter already does.
 */
let monthlyTableReady = false
async function ensureMonthlyTable(
  db: NonNullable<ReturnType<typeof getDb>>
): Promise<void> {
  if (monthlyTableReady) return
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ai_usage_monthly (
         owner_id   TEXT NOT NULL,
         month      TEXT NOT NULL,
         spent_usd  REAL NOT NULL DEFAULT 0,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (owner_id, month)
       )`
    )
    .run()
  monthlyTableReady = true
}

/**
 * Return USD `ownerId` has spent on AI this billing cycle. Keyed by
 * {@link periodKeyForOwner} — the subscription's cycle window when one is
 * live, else the calendar UTC month. Returns 0 when D1 is unavailable or no
 * row exists yet, so OSS deployments are never gated.
 */
export async function getAiSpendThisMonth(
  ownerId: string,
  now: Date = new Date()
): Promise<number> {
  const db = getDb()
  if (!db) return 0
  try {
    await ensureMonthlyTable(db)
    const periodKey = await periodKeyForOwner(ownerId, now)
    const row = await db
      .prepare(
        `SELECT spent_usd FROM ai_usage_monthly WHERE owner_id = ?1 AND month = ?2`
      )
      .bind(ownerId, periodKey)
      .first<{ spent_usd: number }>()
    return row?.spent_usd ?? 0
  } catch {
    return 0
  }
}

/**
 * Add `amountUsd` to `ownerId`'s monthly spend accumulator, keyed by
 * {@link periodKeyForOwner} (subscription billing cycle, or the calendar UTC
 * month with no live subscription). Fed by the already-computed
 * `estimatedCostUsd` after a successful generation. Ignores non-positive /
 * non-finite amounts. No-op when D1 is unavailable.
 */
export async function addAiSpend(
  ownerId: string,
  amountUsd: number,
  now: Date = new Date()
): Promise<void> {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return
  const db = getDb()
  if (!db) return
  try {
    await ensureMonthlyTable(db)
    const periodKey = await periodKeyForOwner(ownerId, now)
    const updatedAt = Math.floor(now.getTime() / 1000)
    await db
      .prepare(
        `INSERT INTO ai_usage_monthly (owner_id, month, spent_usd, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner_id, month) DO UPDATE SET
           spent_usd  = spent_usd + excluded.spent_usd,
           updated_at = excluded.updated_at`
      )
      .bind(ownerId, periodKey, amountUsd, updatedAt)
      .run()
  } catch {
    // Swallow: a missing table or transient D1 error must not break the request.
  }
}

/**
 * Meter one request's actual USD cost as overage — but only for plans that
 * publish an overage policy (`plan.aiOverage`).
 *
 * Free (`aiOverage: null`) hard-caps: the daily-message gate ({@link
 * checkAiDailyLimit} in `entitlements.ts`) already blocks it at its daily
 * allowance, so this is a deliberate no-op — Free never accrues billable
 * overage. Enterprise is also `aiOverage: null` (BYOK/unlimited) and likewise
 * never meters. Paid tiers (Pro/Max, `aiOverage` set) accumulate every
 * request's cost against `aiMonthlyUsdBudget` via {@link addAiSpend}, which is
 * itself fail-open (no-op when D1 is unavailable) — so self-hosted/OSS is
 * never metered.
 */
export async function meterAiOverage(
  plan: Plan,
  ownerId: string,
  requestCostUsd: number,
  now: Date = new Date()
): Promise<void> {
  if (plan.aiOverage == null) return
  await addAiSpend(ownerId, requestCostUsd, now)
}
