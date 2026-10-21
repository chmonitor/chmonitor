/**
 * TTL rewrite amplification: pure classifier + row-to-insight mapping.
 *
 * No I/O. The SQL lives in `ttl-rewrite-collector.ts`; the partition-key
 * heuristic here sits beside `lib/health/ttl-partition-heuristics` (regex over
 * the `system.tables` text, no SQL parsing).
 *
 * Background (#4069): a row TTL on a table whose `PARTITION BY` is coarser than
 * the TTL (typically `toYYYYMM(ts)` with `ts + INTERVAL 90 DAY`) expires a few
 * rows every day. Without `ttl_only_drop_parts = 1`, ClickHouse rewrites the
 * oldest partition's parts on every `merge_with_ttl_timeout` until it is empty,
 * which shows up in `system.part_log` as `TTLDeleteMerge` merges that read far
 * more than the table ingests.
 */

import type { InsightCandidate } from './types'

import { formatReadableSize } from '../format-readable'

const TIB = 1024 ** 4

/** Per-host bytes read by `TTLDeleteMerge` merges in the window to flag a table. */
export const TTL_REWRITE_MIN_READ_BYTES = TIB
/** Bytes read by TTL merges / bytes ingested by `NewPart`. */
export const TTL_REWRITE_MIN_AMPLIFICATION = 4
/** `system.part_log` look-back. */
export const TTL_REWRITE_WINDOW_DAYS = 14

export interface TtlRewriteRow {
  database: string
  table: string
  /** Sum of `read_bytes` over `TTLDeleteMerge` merges in the window. */
  ttlReadBytes: number
  /** Sum of `size_in_bytes` over `NewPart` events in the window. */
  ingestBytes: number
  partitionKey: string
  ttlExpression: string
  /** '1' / '0' from `engine_full` SETTINGS, else the server default; '' = unknown. */
  ttlOnlyDropParts: string
}

export interface TtlRewriteVerdict {
  flagged: boolean
  /** read / ingest; ingest 0 counts as 1 byte so a rewrite with no ingest flags. */
  amplification: number
}

/** Identifiers that can appear in a TTL clause or partition key but are not columns. */
const NON_COLUMN_WORDS = new Set(
  (
    'interval year quarter month week day hour minute second delete to disk ' +
    'volume where group by set recompress codec and or not null as if in'
  ).split(' ')
)

/** Column names referenced by a TTL expression or partition key (heuristic). */
export function referencedColumns(expression: string): Set<string> {
  const text = expression.replace(/'(?:[^'\\]|\\.)*'/g, ' ')
  const out = new Set<string>()
  for (const m of text.matchAll(
    /`([^`]+)`|\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g
  )) {
    const name = (m[1] ?? m[2]) as string
    if (m[1] === undefined && NON_COLUMN_WORDS.has(name.toLowerCase())) continue
    out.add(name.toLowerCase())
  }
  return out
}

/** Partition granularity coarser than a day: parts of one partition expire at different times. */
const COARSE_PARTITION_RE =
  /toYYYYMM(?!DD)|toMonday|toYearWeek|toISOWeek|toStartOf(Month|Week|Quarter|Year|ISOYear)|toYear\b|toMonth\b|toQuarter\b|toRelative(Month|Quarter|Year)|toStartOfInterval[^)]*\b(MONTH|QUARTER|YEAR|WEEK)\b/i

/**
 * True when the partition key already isolates the TTL column at day (or
 * finer) granularity, so whole partitions expire together and a TTL merge has
 * little left to rewrite. A coarse key (monthly, weekly, ...) on the TTL
 * column is the problem case, not an exemption.
 */
export function partitionKeyAlignsWithTtl(
  partitionKey: string,
  ttlExpression: string
): boolean {
  if (!partitionKey.trim() || !ttlExpression.trim()) return false
  if (COARSE_PARTITION_RE.test(partitionKey)) return false
  const ttlColumns = referencedColumns(ttlExpression)
  for (const col of referencedColumns(partitionKey)) {
    if (ttlColumns.has(col)) return true
  }
  return false
}

export function classifyTtlRewrite(row: TtlRewriteRow): TtlRewriteVerdict {
  const amplification = row.ttlReadBytes / Math.max(row.ingestBytes, 1)
  const flagged =
    row.ttlExpression.trim().length > 0 &&
    row.ttlOnlyDropParts.trim() !== '1' &&
    row.ttlReadBytes >= TTL_REWRITE_MIN_READ_BYTES &&
    amplification >= TTL_REWRITE_MIN_AMPLIFICATION &&
    !partitionKeyAlignsWithTtl(row.partitionKey, row.ttlExpression)
  return { flagged, amplification }
}

export function ttlRewriteRowFromRecord(
  rec: Record<string, unknown>
): TtlRewriteRow {
  return {
    database: String(rec.database ?? ''),
    table: String(rec.table ?? ''),
    ttlReadBytes: Number(rec.ttl_read_bytes) || 0,
    ingestBytes: Number(rec.ingest_bytes) || 0,
    partitionKey: String(rec.partition_key ?? ''),
    ttlExpression: String(rec.ttl_expression ?? ''),
    ttlOnlyDropParts: String(rec.ttl_only_drop_parts ?? ''),
  }
}

/** Worst flagged table (most TTL bytes read) -> at most one warning insight. */
export function insightFromTtlRewriteRows(rows: unknown): InsightCandidate[] {
  if (!Array.isArray(rows)) return []
  let worst: { row: TtlRewriteRow; amplification: number } | null = null
  for (const raw of rows) {
    const row = ttlRewriteRowFromRecord((raw ?? {}) as Record<string, unknown>)
    const verdict = classifyTtlRewrite(row)
    if (!verdict.flagged) continue
    if (!worst || row.ttlReadBytes > worst.row.ttlReadBytes) {
      worst = { row, amplification: verdict.amplification }
    }
  }
  if (!worst) return []

  const { row, amplification } = worst
  const fq = `${row.database}.${row.table}`
  const ratio =
    row.ingestBytes > 0 ? `${amplification.toFixed(1)}x` : 'no ingest recorded'
  return [
    {
      severity: 'warning',
      category: 'storage',
      // Table in the metric (not the title) so each table keeps its own stable
      // dismissal; the title stays count-free. Prefix is matched in deriveAction.
      metric: `ttl_rewrite:${fq}`,
      title: `${fq} rewrites data to expire its TTL`,
      detail:
        `${fq}: over the last ${TTL_REWRITE_WINDOW_DAYS} days TTL merges read ` +
        `${formatReadableSize(row.ttlReadBytes, 2)} on this host while ` +
        `${formatReadableSize(row.ingestBytes, 2)} was ingested (${ratio}). ` +
        `PARTITION BY ${row.partitionKey || '(none)'}, TTL ${row.ttlExpression}, ` +
        `ttl_only_drop_parts is not enabled. This is a merge cost issue (disk, ` +
        `IO and CPU), not data loss. Options to evaluate: enable ` +
        `ttl_only_drop_parts = 1 (whole parts are dropped, at the price of ` +
        `keeping up to one extra partition on disk) or align PARTITION BY with ` +
        `the TTL column at a finer granularity. The check reads engine_full, a ` +
        `heuristic, and is recommend-only: nothing is changed.`,
      value: Math.round(amplification * 10) / 10,
      action: { label: 'View TTL inventory', href: '/ttl-partition-health' },
    },
  ]
}
