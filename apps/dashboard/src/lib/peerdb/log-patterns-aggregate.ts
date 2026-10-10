/**
 * Fleet log-pattern aggregation for `GET /api/v1/peerdb/log-patterns`
 * (issue #3678).
 *
 * Reads `POST /v1/mirrors/logs` for EVERY mirror through the bounded sweep
 * pool (`sweep-pool.ts`), keeps entries inside the requested time window, and
 * groups them by message pattern. The browser used to fan out one request per
 * mirror and stopped at 25 mirrors; this moves the fan-out server-side with a
 * concurrency bound and reports coverage honestly instead of silently capping.
 *
 * Pure apart from the injected `fetchLogs`, so the pool bound, the window, and
 * partial coverage are unit-testable without a PeerDB.
 */

import type { LogFeedEntry } from './log-groups'
import type { PoolOutcome } from './sweep-pool'
import type { MirrorLog } from './types'

import { groupLogsByPattern } from './log-fingerprint'
import { toLogFeedEntry } from './log-groups'
import { mapWithPool, startSweepBudget } from './sweep-pool'

export type LogWindow = '1h' | '24h' | '7d'

export const LOG_WINDOWS: readonly LogWindow[] = ['1h', '24h', '7d']

export const DEFAULT_LOG_WINDOW: LogWindow = '24h'

const WINDOW_MS: Record<LogWindow, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
}

/** Lines requested per mirror. PeerDB's logs API has no time filter. */
export const LOG_PATTERNS_PER_MIRROR = 100

/** Unknown/missing values fall back to the default window. */
export function parseLogWindow(value: string | null | undefined): LogWindow {
  return (LOG_WINDOWS as readonly string[]).includes(value ?? '')
    ? (value as LogWindow)
    : DEFAULT_LOG_WINDOW
}

export function logWindowMs(window: LogWindow): number {
  return WINDOW_MS[window]
}

/** A pattern group without its entries (the entries ship once, flat). */
export interface LogPatternSummary {
  fingerprint: string
  level: LogFeedEntry['level']
  count: number
  firstSeen: number | null
  lastSeen: number | null
  mirrors: string[]
}

export interface FleetLogPatterns {
  window: LogWindow
  /** Window start / end, epoch ms. */
  from: number
  to: number
  /** In-window entries across the fleet, newest first. */
  entries: LogFeedEntry[]
  patterns: LogPatternSummary[]
  /** Mirrors whose logs were read successfully. */
  mirrorsRead: number
  mirrorsTotal: number
  /**
   * Mirrors that returned a full page whose oldest line is still inside the
   * window — older in-window lines for them were not fetched.
   */
  mirrorsTruncated: number
  /** True when any mirror failed or was skipped by the wall-clock budget. */
  partial: boolean
}

export interface CollectFleetLogPatternsOptions {
  mirrors: readonly string[]
  /** Reads one mirror's logs. May throw; a throw counts as unread. */
  fetchLogs: (mirror: string, signal: AbortSignal) => Promise<MirrorLog[]>
  /** Converts a raw timestamp to epoch ms. */
  parseTs: (value: string | number | undefined) => number | null
  window: LogWindow
  concurrency: number
  budgetMs: number
  perMirror?: number
  now?: number
}

export async function collectFleetLogPatterns(
  opts: CollectFleetLogPatternsOptions
): Promise<FleetLogPatterns> {
  const to = opts.now ?? Date.now()
  const from = to - logWindowMs(opts.window)
  const perMirror = opts.perMirror ?? LOG_PATTERNS_PER_MIRROR

  const budget = startSweepBudget(opts.budgetMs)
  let outcomes: PoolOutcome<MirrorLog[] | null>[]
  try {
    outcomes = await mapWithPool(
      opts.mirrors,
      opts.concurrency,
      async (mirror) => {
        try {
          return await opts.fetchLogs(mirror, budget.signal)
        } catch {
          return null
        }
      },
      budget.signal
    )
  } finally {
    budget.dispose()
  }

  const entries: LogFeedEntry[] = []
  let mirrorsRead = 0
  let mirrorsTruncated = 0
  outcomes.forEach((outcome, i) => {
    if (outcome.kind !== 'done' || outcome.value === null) return
    mirrorsRead++
    const mirror = opts.mirrors[i] as string
    const logs = outcome.value
    let oldest = Number.POSITIVE_INFINITY
    for (const log of logs) {
      const ts = opts.parseTs(log.errorTimestamp)
      if (ts != null && ts < oldest) oldest = ts
      // Untimestamped lines cannot be placed in a window; drop them.
      if (ts == null || ts < from || ts > to) continue
      entries.push(toLogFeedEntry(log, mirror, ts))
    }
    if (logs.length >= perMirror && oldest >= from) mirrorsTruncated++
  })
  entries.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))

  const patterns = groupLogsByPattern(entries).map(
    ({ entries: _e, sample: _s, ...rest }) => rest
  )

  return {
    window: opts.window,
    from,
    to,
    entries,
    patterns,
    mirrorsRead,
    mirrorsTotal: opts.mirrors.length,
    mirrorsTruncated,
    partial: mirrorsRead < opts.mirrors.length,
  }
}
