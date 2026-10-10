import type { MirrorLogLevel } from './mirror-logs'

/**
 * Message-pattern fingerprinting for PeerDB mirror logs.
 *
 * PeerDB logs are dominated by repeats that differ only in variable parts
 * (`replicated 3 partitions ... for table public.orders`). Replacing those
 * parts with stable placeholders lets the UI (and the alert lane, #3675)
 * group identical patterns the same way. Pure and order-sensitive: specific
 * shapes (timestamps, UUIDs, host:port, LSNs) are stripped before the generic
 * number pass so each collapses to one placeholder.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // ISO-8601 / SQL timestamps: 2026-10-11T08:15:30.123Z, 2026-10-11 08:15:30+00
  [
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?/g,
    '<ts>',
  ],
  // UUIDs
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '<uuid>',
  ],
  // host:port (IPv4 or hostname)
  [
    /\b(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+(?:\.[a-z0-9-]+)*):\d{2,5}\b/gi,
    '<host>',
  ],
  // Postgres LSNs: 0/1A2B3C4D
  [/\b[0-9A-F]{1,8}\/[0-9A-F]{1,8}\b/gi, '<lsn>'],
  // Quoted identifiers / literals: "public"."orders", 'x', `y`
  [/"[^"]*"(?:\."[^"]*")*|'[^']*'|`[^`]*`/g, '<name>'],
  // Qualified names: schema.table, db.schema.table
  [/\b[a-z_][\w$]*(?:\.[a-z_][\w$]*)+\b/gi, '<name>'],
  // Bare table name: "for table orders"
  [/\b(table)\s+(?!<)[\w$]+/gi, '$1 <name>'],
  // Any remaining number (ints, decimals, hex ids)
  [/\b0x[0-9a-f]+\b|\b\d+(?:\.\d+)?\b/gi, '<n>'],
]

/** Normalize a log message to its pattern. Empty/missing input gives `''`. */
export function fingerprintLogMessage(
  message: string | undefined | null
): string {
  let out = String(message ?? '')
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out.replace(/\s+/g, ' ').trim()
}

export interface FingerprintInput {
  message: string
  level: MirrorLogLevel
  mirror: string
  /** Epoch ms, or null when the entry has no parseable timestamp. */
  ts: number | null
}

export interface LogPatternGroup<
  T extends FingerprintInput = FingerprintInput,
> {
  fingerprint: string
  level: MirrorLogLevel
  count: number
  firstSeen: number | null
  lastSeen: number | null
  /** Distinct mirrors, most recently active first. */
  mirrors: string[]
  /** Newest entry in the group. */
  sample: T
  /** All entries, newest first. */
  entries: T[]
}

const SEVERITY: Record<MirrorLogLevel, number> = { error: 2, warn: 1, info: 0 }

/**
 * Group entries under a caller-chosen key. `level` is the highest severity in
 * the group. Groups sort by severity, then last seen, then count, so errors
 * and warnings surface above info noise. `fingerprint` carries the group label.
 */
export function groupLogsByKey<T extends FingerprintInput>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  labelOf: (entry: T, key: string) => string = (_, key) => key
): LogPatternGroup<T>[] {
  const byKey = new Map<string, T[]>()
  for (const e of entries) {
    const key = keyOf(e)
    const list = byKey.get(key)
    if (list) list.push(e)
    else byKey.set(key, [e])
  }

  const groups: LogPatternGroup<T>[] = []
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    const times = sorted.map((e) => e.ts).filter((t): t is number => t != null)
    const mirrors = [...new Set(sorted.map((e) => e.mirror))]
    const level = sorted.reduce<MirrorLogLevel>(
      (top, e) => (SEVERITY[e.level] > SEVERITY[top] ? e.level : top),
      'info'
    )
    groups.push({
      fingerprint: labelOf(sorted[0], key),
      level,
      count: sorted.length,
      firstSeen: times.length ? Math.min(...times) : null,
      lastSeen: times.length ? Math.max(...times) : null,
      mirrors,
      sample: sorted[0],
      entries: sorted,
    })
  }

  return groups.sort(
    (a, b) =>
      SEVERITY[b.level] - SEVERITY[a.level] ||
      (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
      b.count - a.count
  )
}

/**
 * Group by `level + fingerprint` (an error and an info line with the same text
 * are different signals).
 */
export function groupLogsByPattern<T extends FingerprintInput>(
  entries: readonly T[]
): LogPatternGroup<T>[] {
  return groupLogsByKey(
    entries,
    (e) => `${e.level}\u0000${fingerprintLogMessage(e.message)}`,
    (e) => fingerprintLogMessage(e.message)
  )
}
