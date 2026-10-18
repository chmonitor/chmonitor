/** SQL text parsing for the MV/projection designer (GROUP BY keys, aggregate calls). Pure, no I/O. */

export interface AggregateCall {
  func: string
  arg: string
}

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

function skipQuotedSpan(input: string, start: number): number {
  const quote = input[start]
  let i = start + 1
  while (i < input.length) {
    if (quote === "'" && input[i] === '\\') {
      i += 2
      continue
    }
    if (input[i] === quote) {
      if (quote === "'" && input[i + 1] === "'") {
        i += 2
        continue
      }
      return i
    }
    i += 1
  }
  return input.length - 1
}

export function isBareIdentifier(key: string): boolean {
  return /^[A-Za-z_][\w$]*$/.test(key.trim())
}

export function formatGroupByListForSql(keys: readonly string[]): string {
  if (keys.every(isBareIdentifier)) return keys.join(', ')
  return keys
    .map((key) => {
      const trimmed = key.trim()
      if (isBareIdentifier(trimmed)) return trimmed
      return trimmed
    })
    .join(', ')
}

/** Top-level only: commas inside parens or string literals are not split points. */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = skipQuotedSpan(input, i)
      current += input.slice(i, end + 1)
      i = end
      continue
    }
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

/** Returns `[]` for no GROUP BY, or forms this doesn't model (`GROUP BY ALL`, `GROUPING SETS`, `ROLLUP`, `CUBE`). */
export function extractGroupByKeys(sql: string): string[] {
  const match = sql.match(GROUP_BY_CLAUSE_PATTERN)
  if (!match) return []
  const clause = match[1].trim()
  if (!clause || /^(ALL\b|GROUPING SETS|ROLLUP|CUBE)/i.test(clause)) return []
  return splitTopLevelCommas(clause)
}

export function extractAggregateCalls(sql: string): AggregateCall[] {
  const calls: AggregateCall[] = []
  for (const match of sql.matchAll(AGGREGATE_CALL_PATTERN)) {
    calls.push({ func: match[1].toLowerCase(), arg: match[2].trim() })
  }
  return calls
}
