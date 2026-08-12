/**
 * SQL text parsing for the MV/projection designer — extracting GROUP BY keys
 * and aggregate function calls from a query's raw text. Pure, no I/O.
 *
 * See `./index.ts` for the module overview.
 */

import type { AggregateCall } from './index'

const AGGREGATE_FUNCTION_NAMES = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'uniq',
  'uniqCombined',
  'uniqCombined64',
  'uniqExact',
  'uniqHLL12',
  'quantile',
  'quantiles',
  'quantileExact',
  'median',
  'groupArray',
  'groupUniqArray',
  'argMin',
  'argMax',
  'any',
  'anyLast',
  'topK',
  'stddevPop',
  'stddevSamp',
  'varPop',
  'varSamp',
]

// Note: parametric two-arg-list functions (`quantile(0.95)(col)`) are not
// fully parsed — the first parenthesized group is captured as `arg`, which
// for these is the level, not the column. This still classifies correctly
// as "mixed" (quantile is never sum-compatible), but the generated DDL's
// select expression for such a call carries a caveat rather than silently
// guessing the column; see `aggSelectExpr` in `./ddl.ts`.
const AGGREGATE_CALL_PATTERN = new RegExp(
  `\\b(${AGGREGATE_FUNCTION_NAMES.join('|')})\\s*\\(([^()]*)\\)`,
  'gi'
)

const GROUP_BY_CLAUSE_PATTERN =
  /\bGROUP\s+BY\b([\s\S]*?)(?:\bORDER\s+BY\b|\bHAVING\b|\bLIMIT\b|\bSETTINGS\b|\bFORMAT\b|$)/i

/**
 * Split a comma-separated expression list at the top level only — commas
 * nested inside function-call parens (`toDate(event_time), user_id`) are not
 * split points.
 */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * Extract the GROUP BY key expressions from a query's text. Returns `[]` for
 * queries with no GROUP BY, or exotic forms (`GROUP BY ALL`, `GROUPING SETS`,
 * `ROLLUP`, `CUBE`) that this v1 doesn't model.
 */
export function extractGroupByKeys(sql: string): string[] {
  const match = sql.match(GROUP_BY_CLAUSE_PATTERN)
  if (!match) return []
  const clause = match[1].trim()
  if (!clause || /^(ALL\b|GROUPING SETS|ROLLUP|CUBE)/i.test(clause)) return []
  return splitTopLevelCommas(clause)
}

/** Extract aggregate function calls (`sum(x)`, `count()`, `uniq(y)`, …) from a query's text. */
export function extractAggregateCalls(sql: string): AggregateCall[] {
  const calls: AggregateCall[] = []
  for (const match of sql.matchAll(AGGREGATE_CALL_PATTERN)) {
    calls.push({ func: match[1].toLowerCase(), arg: match[2].trim() })
  }
  return calls
}
