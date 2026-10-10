/**
 * Pure classifiers for the operational insight collectors.
 *
 * Each function maps a raw metric (already extracted from a ClickHouse system
 * table) to an `InsightCandidate` or `null` when the reading is not worth
 * surfacing. They are deliberately pure (no ClickHouse / store I/O) so they can
 * be unit-tested directly against boundary values — the same split the anomaly
 * collector uses for `decideSeverity`. `collectors.ts` owns the SQL and calls
 * these; the thresholds live here as named constants so tests and collectors
 * share one source of truth.
 */

import type { InsightCandidate } from './types'

import {
  classifyPartsPressure,
  type PartsPressureRow,
} from '../health/parts-pressure'

/** Detached parts (non-broken reasons): below this many, don't surface at all. */
export const DETACHED_PARTS_MIN = 10

/** Replication-queue entries retried more than this many times count as stuck. */
export const REPLICATION_QUEUE_STUCK_TRIES = 100
/** Replication-queue entries older than this (seconds) count as stuck. */
export const REPLICATION_QUEUE_STUCK_AGE_SECONDS = 3600
/** At/above this many stuck queue entries the finding is critical. */
export const REPLICATION_QUEUE_STUCK_CRITICAL = 50

/** At/above this many stuck+failing mutations, escalate warning → critical. */
export const STUCK_MUTATIONS_CRITICAL = 10

/** A live query must run at least this long (seconds) before we surface it. */
export const LONG_QUERY_WARN_SECONDS = 300
/** At/above this runtime (seconds) the long-running query is critical. */
export const LONG_QUERY_CRITICAL_SECONDS = 1800

/** Render a duration in seconds as a compact human string (`45s` / `12m` / `1.5h`). */
function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round((seconds / 3600) * 10) / 10}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

/**
 * Detached parts that are NOT broken (user DETACH, `ignored`, `clone`, ...).
 * They occupy disk without being queryable, so a growing count is a cleanup
 * signal — informational only. Broken parts are split out into
 * `checkBrokenDetachedParts` because they mean damaged data, not housekeeping.
 */
export function checkDetachedParts(count: number): InsightCandidate | null {
  if (!Number.isFinite(count) || count < DETACHED_PARTS_MIN) return null
  return {
    severity: 'info',
    category: 'storage',
    metric: 'detached_parts',
    title: `${count} detached parts need review`,
    detail: `This cluster has ${count} detached parts that are not broken — usually leftovers from ALTER ... DETACH, replica clones, or ignored parts. They occupy disk without being queryable. What to do: check each part's reason, ATTACH the ones you still need, and run ALTER TABLE ... DROP DETACHED PART for the rest.`,
    value: count,
    action: { label: 'View detached parts', href: '/detached-parts' },
  }
}

/**
 * Detached parts whose reason starts with `broken` (`broken`,
 * `broken-on-start`, ...) were detached because ClickHouse found them damaged —
 * checksum mismatch, missing files, failed load. Any one is possible data loss
 * on that replica, so this is critical.
 */
export function checkBrokenDetachedParts(
  count: number
): InsightCandidate | null {
  if (!Number.isFinite(count) || count < 1) return null
  const plural = count > 1
  return {
    severity: 'critical',
    category: 'storage',
    metric: 'broken_detached_parts',
    title: `${count} broken part${plural ? 's were' : ' was'} detached`,
    detail: `${count} part${plural ? 's were' : ' was'} detached with a "broken" reason — ClickHouse found ${plural ? 'them' : 'it'} damaged (checksum mismatch, missing files, or a failed load), so those rows are not queryable. What to do: check disk health and the server log for the cause. On a replicated table the data is usually re-fetched from another replica — confirm it is there before dropping the broken part. On a non-replicated table, restore it from a backup.`,
    value: count,
    action: { label: 'View detached parts', href: '/detached-parts' },
  }
}

/**
 * Replication-queue entries that keep retrying (num_tries over the threshold)
 * or have waited over an hour are not making progress: the replica falls
 * behind and merges/fetches pile up behind them.
 */
export function checkStuckReplicationQueue(
  count: number,
  maxTries: number
): InsightCandidate | null {
  if (!Number.isFinite(count) || count < 1) return null
  const plural = count > 1
  const tries = Number.isFinite(maxTries) ? Math.round(maxTries) : 0
  return {
    severity:
      count >= REPLICATION_QUEUE_STUCK_CRITICAL ? 'critical' : 'warning',
    category: 'reliability',
    metric: 'stuck_replication_queue',
    title: `${count} replication queue entr${plural ? 'ies are' : 'y is'} stuck`,
    detail: `${count} replication queue entr${plural ? 'ies have' : 'y has'} been retried more than ${REPLICATION_QUEUE_STUCK_TRIES} times or waited over an hour (most retries: ${tries}). The replica cannot apply ${plural ? 'them' : 'it'}, so it falls behind. What to do: read last_exception and postpone_reason in system.replication_queue. Common causes are a part missing on every replica, Keeper trouble, or a full disk. Fix the cause, then run SYSTEM RESTART REPLICA if the entry still does not move.`,
    value: count,
    action: { label: 'View replication queue', href: '/replication-queue' },
  }
}

/**
 * Insert back-pressure. `DelayedInserts` (current gauge) counts INSERTs slowed
 * because a partition is past parts_to_delay_insert; `RejectedInserts`
 * (ProfileEvent, summed over the last hour) counts INSERTs refused with
 * TOO_MANY_PARTS. A rejection is a lost write for a client that does not retry.
 */
export function checkInsertBackpressure(
  delayed: number,
  rejected: number
): InsightCandidate | null {
  const d = Number.isFinite(delayed) ? Math.max(0, Math.round(delayed)) : 0
  const r = Number.isFinite(rejected) ? Math.max(0, Math.round(rejected)) : 0
  if (d < 1 && r < 1) return null
  // Title carries no counts so a dismissal survives regeneration (stable key
  // is host:category:metric:title); the counts ride in detail/value.
  return {
    severity: r > 0 ? 'critical' : 'warning',
    category: 'performance',
    metric: 'insert_backpressure',
    title: r > 0 ? 'Inserts are being rejected' : 'Inserts are being delayed',
    detail: `${d} insert${d === 1 ? ' is' : 's are'} delayed right now and ${r} ${r === 1 ? 'was' : 'were'} rejected with TOO_MANY_PARTS in the last hour — a partition has more active parts than merges can keep up with. What to do: batch inserts into fewer, larger blocks (or enable async_insert), find the partition with the most parts on the merges page, and check that merges are not stalled by disk or a too-fine partition key.`,
    value: r > 0 ? r : d,
    action: { label: 'View merges', href: '/merges' },
  }
}

/**
 * Mutations that are not done yet AND already carry a failure reason are stuck:
 * they block subsequent ALTERs on the table and pile up until resolved.
 */
export function checkStuckMutations(count: number): InsightCandidate | null {
  if (!Number.isFinite(count) || count < 1) return null
  const plural = count > 1
  return {
    severity: count >= STUCK_MUTATIONS_CRITICAL ? 'critical' : 'warning',
    category: 'reliability',
    metric: 'stuck_mutations',
    title: `${count} mutation${plural ? 's are' : ' is'} failing to complete`,
    detail: `${count} mutation${plural ? 's' : ''} ${plural ? 'are' : 'is'} unfinished with a failure reason set. Stuck mutations block further ALTERs on the affected tables and keep retrying — inspect system.mutations for the latest_fail_reason and fix or KILL the mutation.`,
    value: count,
    action: { label: 'View mutations', href: '/mutations' },
  }
}

/**
 * A single very long-running live query holds locks and memory; surfacing the
 * longest one flags a likely runaway scan or a query missing a filter.
 */
export function checkLongRunningQuery(
  maxElapsedSeconds: number,
  count: number
): InsightCandidate | null {
  if (
    !Number.isFinite(maxElapsedSeconds) ||
    maxElapsedSeconds < LONG_QUERY_WARN_SECONDS
  )
    return null
  const additional = Number.isFinite(count) && count > 1 ? count - 1 : 0
  return {
    severity:
      maxElapsedSeconds >= LONG_QUERY_CRITICAL_SECONDS ? 'critical' : 'warning',
    category: 'performance',
    metric: 'longest_running_query',
    title: `A query has been running for ${formatDuration(maxElapsedSeconds)}`,
    detail: `The longest live query has been running for ${formatDuration(maxElapsedSeconds)}${additional ? ` (${additional} other quer${additional > 1 ? 'ies' : 'y'} over ${formatDuration(LONG_QUERY_WARN_SECONDS)})` : ''}. Long-running queries hold locks and memory — check for a runaway scan or a missing filter, and cancel it if it is stuck.`,
    value: Math.round(maxElapsedSeconds),
    action: { label: 'Open running queries', href: '/running-queries' },
  }
}

/**
 * Predictive "too many parts" early warning. Given the worst partition's active
 * parts, its effective throw/delay limits, and (when `system.part_log` is
 * available) the projected hours until it hits `parts_to_throw_insert`, decide
 * whether to surface a finding and at what severity. Severity policy lives in
 * `classifyPartsPressure`; this wraps the winning partition into a candidate.
 *
 * The stable key is `host:storage:parts_pressure:<title>`, so the title carries
 * only the partition identity (never the run-to-run projected hours) — a
 * dismissal survives regeneration while the projected time keeps updating in the
 * detail text.
 */
export function checkPartsPressure(
  row: PartsPressureRow
): InsightCandidate | null {
  const severity = classifyPartsPressure({
    parts: row.parts,
    throwLimit: row.throwLimit,
    delayLimit: row.delayLimit,
    hoursToThrow: row.hoursToThrow,
  })
  if (!severity) return null

  const target = `${row.database}.${row.table}`
  const fillPercent =
    row.throwLimit > 0 ? Math.round((row.parts * 100) / row.throwLimit) : 0

  let projection: string
  if (row.isDelaying) {
    projection = `It has ${row.parts} active parts, at or past parts_to_delay_insert (${row.delayLimit}) — inserts are already being throttled and will be rejected at ${row.throwLimit}.`
  } else if (row.hoursToThrow !== null) {
    const when =
      row.hoursToThrow <= 0
        ? 'now'
        : row.hoursToThrow < 1
          ? `~${Math.round(row.hoursToThrow * 60)}m`
          : `~${Math.round(row.hoursToThrow * 10) / 10}h`
    projection = `At the current net rate of ${row.netPartsPerHour ?? 0} parts/hour it will reach parts_to_throw_insert (${row.throwLimit}) in ${when} — it now has ${row.parts} parts (${fillPercent}%).`
  } else {
    // part_log disabled — fill-percent-only fallback, no time projection.
    projection = `It has ${row.parts} active parts (${fillPercent}% of parts_to_throw_insert ${row.throwLimit}). Enable system.part_log to project when inserts will be rejected.`
  }

  return {
    severity,
    category: 'storage',
    metric: 'parts_pressure',
    title: `${target} is approaching too many parts`,
    detail: `Partition \`${row.partition}\` of ${target} is under parts pressure. ${projection} Increase insert batch sizes, speed up merges (background_pool_size / faster disk), or coarsen the partition key.`,
    value: fillPercent,
    action: { label: 'View merges', href: '/merges' },
  }
}

/**
 * Dictionaries in the FAILED state error (or fall back) for every query that
 * uses them — almost always a source-connectivity or definition problem.
 */
export function checkFailedDictionaries(
  count: number
): InsightCandidate | null {
  if (!Number.isFinite(count) || count < 1) return null
  const plural = count > 1
  return {
    severity: 'warning',
    category: 'reliability',
    metric: 'failed_dictionaries',
    title: `${count} dictionar${plural ? 'ies' : 'y'} failed to load`,
    detail: `${count} dictionar${plural ? 'ies are' : 'y is'} in the FAILED state. Queries that read ${plural ? 'these dictionaries' : 'this dictionary'} will error or fall back — check the source connectivity and last_exception in system.dictionaries.`,
    value: count,
    action: { label: 'View dictionaries', href: '/dictionaries' },
  }
}
