/**
 * Lightweight heuristic checks on ClickHouse EXPLAIN PLAN text.
 *
 * These are UI-level heuristics — they pattern-match on plan text and SQL
 * to surface likely performance issues as actionable suggestions. They are
 * NOT a substitute for the AI agent's deeper analysis.
 *
 * All functions are pure: no side effects, no I/O, no browser APIs.
 */

export type HeuristicSeverity = 'warning' | 'info'

export interface Suggestion {
  /** Stable key for dedup / dismissal. */
  id: string
  severity: HeuristicSeverity
  /** Short label for the chip. */
  title: string
  /** 1-2 sentence explanation. */
  rationale: string
}

/** Full result for a single query. */
export interface ExplainAnalysis {
  sql: string
  /** Truncated SQL for display. */
  title: string
  /** Raw EXPLAIN lines. */
  planLines: string[]
  suggestions: Suggestion[]
  /** True if EXPLAIN fetch succeeded. */
  ok: boolean
  error?: string
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Collapse internal whitespace and truncate at `maxLen`, appending '…' if cut.
 */
export function truncateSql(sql: string, maxLen = 80): string {
  const collapsed = sql.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLen) return collapsed
  return `${collapsed.slice(0, maxLen)}…`
}

export function checkFullScanWithoutPrewhere(
  sql: string,
  planLines: string[]
): Suggestion | null {
  const hasMergeTreeScan = planLines.some((l) => /ReadFromMergeTree/i.test(l))
  if (!hasMergeTreeScan) return null

  const planHasPrewhere = planLines.some((l) => /PREWHERE/i.test(l))
  const sqlHasPrewhere = /\bPREWHERE\b/i.test(sql)
  if (planHasPrewhere || sqlHasPrewhere) return null

  return {
    id: 'full-scan-no-prewhere',
    severity: 'warning',
    title: 'No PREWHERE filter',
    rationale:
      'Query reads from MergeTree without a PREWHERE clause. Moving the most selective filter to PREWHERE can reduce IO by filtering granules early.',
  }
}

/**
 * Detect missing partition key pruning by checking the Parts: N/M ratio in the
 * plan output.
 */
export function checkMissingPartitionPruning(
  _sql: string,
  planLines: string[]
): Suggestion | null {
  // Look for "Parts: N/M" — e.g. "Parts: 450/500" or "Selected parts: 450/500"
  const partsPattern = /[Pp]arts:\s*(\d+)\/(\d+)/
  for (const line of planLines) {
    const m = partsPattern.exec(line)
    if (!m) continue
    const selected = parseInt(m[1], 10)
    const total = parseInt(m[2], 10)
    if (total === 0) continue
    if (selected > 100 || selected / total > 0.8) {
      return {
        id: 'missing-partition-pruning',
        severity: 'warning',
        title: 'Partition not pruned',
        rationale:
          'The query may be scanning many partitions. Filtering on the partition key column reduces the data scanned.',
      }
    }
  }
  return null
}

/**
 * Warn when a query reads vastly more rows than it returns.
 */
export function checkHighReadRowsToResultRatio(
  _sql: string,
  _planLines: string[],
  readRows?: number,
  resultRows?: number
): Suggestion | null {
  if (
    readRows == null ||
    resultRows == null ||
    readRows <= 1_000_000 ||
    resultRows <= 0
  ) {
    return null
  }
  const ratio = readRows / resultRows
  if (ratio <= 1000) return null

  return {
    id: 'high-read-rows-ratio',
    severity: 'warning',
    title: 'High read:result row ratio',
    rationale: `Reading ${formatNumber(readRows)} rows to return ${formatNumber(resultRows)}. Consider adding or improving index conditions to reduce the scanned range.`,
  }
}

export function checkLargeJoinWithoutKey(
  sql: string,
  planLines: string[]
): Suggestion | null {
  if (!/\bJOIN\b/i.test(sql)) return null

  const hasUnkeyedJoin = planLines.some((line) => {
    if (!/(Cross Join|Hash Join)/i.test(line)) return false
    // If the same line or nearby context mentions "key" or "ON", likely fine.
    return !/(key|ON\b)/i.test(line)
  })
  if (!hasUnkeyedJoin) return null

  return {
    id: 'large-join-without-key',
    severity: 'warning',
    title: 'Unkeyed JOIN detected',
    rationale:
      'A hash or cross join was found in the plan. Ensure JOIN conditions reference indexed or pre-sorted columns to avoid full table products.',
  }
}

/**
 * Surface when the plan has no index usage hints at all.
 */
export function checkNoIndexUsed(
  _sql: string,
  planLines: string[]
): Suggestion | null {
  const hasMergeTreeScan = planLines.some((l) => /ReadFromMergeTree/i.test(l))
  if (!hasMergeTreeScan) return null

  const hasIndexHint = planLines.some((l) =>
    /(with index|Indexes:|Selected marks:)/i.test(l)
  )
  if (hasIndexHint) return null

  return {
    id: 'no-index-hint',
    severity: 'info',
    title: 'No index hints in plan',
    rationale:
      'No index usage was detected in the EXPLAIN output. Run EXPLAIN with indexes=1 to see index analysis.',
  }
}

export function analyzeExplain(
  sql: string,
  planLines: string[],
  readRows?: number,
  resultRows?: number
): Suggestion[] {
  const candidates = [
    checkFullScanWithoutPrewhere(sql, planLines),
    checkMissingPartitionPruning(sql, planLines),
    checkHighReadRowsToResultRatio(sql, planLines, readRows, resultRows),
    checkLargeJoinWithoutKey(sql, planLines),
    checkNoIndexUsed(sql, planLines),
  ]

  const seen = new Set<string>()
  const result: Suggestion[] = []
  for (const s of candidates) {
    if (s && !seen.has(s.id)) {
      seen.add(s.id)
      result.push(s)
    }
  }
  return result
}
