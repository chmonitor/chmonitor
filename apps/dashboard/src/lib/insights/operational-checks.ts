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

/** Detached parts: below this many, don't surface at all. */
export const DETACHED_PARTS_MIN = 10
/** At/above this many detached parts, escalate from notice to warning. */
export const DETACHED_PARTS_WARN = 50

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
 * Detached parts accumulate from failed merges, ATTACH/DETACH operations, or
 * corruption. They consume disk without being queryable, so a growing count is a
 * cleanup signal.
 */
export function checkDetachedParts(count: number): InsightCandidate | null {
  if (!Number.isFinite(count) || count < DETACHED_PARTS_MIN) return null
  return {
    severity: count >= DETACHED_PARTS_WARN ? 'warning' : 'info',
    category: 'storage',
    metric: 'detached_parts',
    title: `${count} detached parts need review`,
    detail: `This cluster has ${count} detached parts — usually leftovers from failed merges, ATTACH/DETACH operations, or corruption. They occupy disk without being queryable. Review them and DROP DETACHED PART once you have confirmed they are safe to remove.`,
    value: count,
    action: { label: 'View tables', href: '/tables' },
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
  const others = Number.isFinite(count) && count > 1 ? count : 0
  return {
    severity:
      maxElapsedSeconds >= LONG_QUERY_CRITICAL_SECONDS ? 'critical' : 'warning',
    category: 'performance',
    metric: 'longest_running_query',
    title: `A query has been running for ${formatDuration(maxElapsedSeconds)}`,
    detail: `The longest live query has been running for ${formatDuration(maxElapsedSeconds)}${others ? ` (${others} queries over a minute)` : ''}. Long-running queries hold locks and memory — check for a runaway scan or a missing filter, and cancel it if it is stuck.`,
    value: Math.round(maxElapsedSeconds),
    action: { label: 'Open running queries', href: '/running-queries' },
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
