import type { FingerprintInput, LogPatternGroup } from './log-fingerprint'
import type { MirrorLog } from './types'

import { groupLogsByKey, groupLogsByPattern } from './log-fingerprint'
import { normalizeLogLevel } from './mirror-logs'

/** A mirror log line normalised for grouping. */
export interface LogFeedEntry extends MirrorLog, FingerprintInput {}

export type LogGroupBy = 'pattern' | 'mirror' | 'table'

export const NO_TABLE_LABEL = '(no table)'

/**
 * Table a log line is about, taken from `... for table <name>` style messages.
 * Quotes are stripped. Returns null when the message names no table.
 */
export function extractLogTable(
  message: string | null | undefined
): string | null {
  const m = /\btable\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))*)/i.exec(
    message ?? ''
  )
  return m ? m[1].replace(/"/g, '') : null
}

export function toLogFeedEntry(
  log: MirrorLog,
  mirror: string,
  ts: number | null
): LogFeedEntry {
  return {
    ...log,
    mirror,
    message: log.errorMessage ?? '',
    level: normalizeLogLevel(log.errorType),
    ts,
  }
}

export function groupLogs<T extends FingerprintInput>(
  entries: readonly T[],
  by: LogGroupBy
): LogPatternGroup<T>[] {
  if (by === 'mirror') return groupLogsByKey(entries, (e) => e.mirror)
  if (by === 'table') {
    return groupLogsByKey(
      entries,
      (e) => extractLogTable(e.message) ?? NO_TABLE_LABEL
    )
  }
  return groupLogsByPattern(entries)
}

/**
 * Per-bucket counts of `entries` across [from, to], for a sparkline. Entries
 * without a timestamp are skipped. A zero-width range puts everything in the
 * last bucket.
 */
export function bucketCounts(
  entries: readonly { ts: number | null }[],
  from: number,
  to: number,
  buckets: number
): number[] {
  const out = new Array<number>(buckets).fill(0)
  const span = to - from
  for (const e of entries) {
    if (e.ts == null || e.ts < from || e.ts > to) continue
    const i = span > 0 ? Math.floor(((e.ts - from) / span) * buckets) : buckets
    out[Math.min(buckets - 1, i)]++
  }
  return out
}

/** Min/max timestamp over all entries, or null when none has a timestamp. */
export function timeRange(
  entries: readonly { ts: number | null }[]
): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const e of entries) {
    if (e.ts == null) continue
    if (e.ts < from) from = e.ts
    if (e.ts > to) to = e.ts
  }
  return from <= to ? { from, to } : null
}

/**
 * Noise control: when any error/warn group exists, info groups are collapsed;
 * otherwise everything stays visible.
 */
export function splitInfoGroups<T extends { level: string }>(
  groups: T[]
): { visible: T[]; collapsed: T[] } {
  const loud = groups.filter((g) => g.level !== 'info')
  if (loud.length === 0) return { visible: groups, collapsed: [] }
  return { visible: loud, collapsed: groups.filter((g) => g.level === 'info') }
}
