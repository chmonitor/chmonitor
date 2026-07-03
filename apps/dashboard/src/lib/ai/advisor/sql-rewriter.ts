/**
 * Query advisor — SQL rewriter.
 *
 * Produces a candidate PREWHERE rewrite for the user to review. This is the
 * one "no DDL" recommendation — a read-only text transform. It NEVER executes
 * the rewritten SQL itself; `impact-estimator.ts`'s `measurePrewhereImpact`
 * may run a read-only `EXPLAIN` on it to measure impact, but the rewritten
 * SELECT is returned as plain text for the user to copy and run themselves.
 */

import type { QueryContext, SqlPredicate } from './types'

const CLAUSE_STOP_WORDS =
  'GROUP BY|ORDER BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'

/**
 * Split a WHERE body on top-level `AND` (i.e. not inside parentheses),
 * so a parenthesized `OR` group is kept intact as one condition instead of
 * being incorrectly torn apart. Not a full SQL parser — good enough for the
 * common case; anything it can't confidently segment is left as a single
 * condition (the caller then just won't find its target column in it, and
 * `proposePrewhereRewrite` returns `null` rather than risk a broken rewrite).
 */
function splitTopLevelAnd(whereBody: string): string[] {
  // Track paren depth per character so an AND inside `(...)` (e.g. a
  // parenthesized OR group) is never treated as a split point.
  const depthAt: number[] = []
  let depth = 0
  for (let i = 0; i < whereBody.length; i++) {
    const ch = whereBody[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    depthAt[i] = depth
  }

  const positions: number[] = []
  const re = /\bAND\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(whereBody)) !== null) {
    if (depthAt[match.index] === 0) positions.push(match.index)
  }

  const parts: string[] = []
  let lastIndex = 0
  for (const pos of positions) {
    parts.push(whereBody.slice(lastIndex, pos).trim())
    lastIndex = pos + 3 // length of "AND"
  }
  parts.push(whereBody.slice(lastIndex).trim())

  return parts.filter(Boolean)
}

/** Locate the WHERE clause span `[start, end)` in `sql` — `start` is the index of the `WHERE` keyword itself. */
function findWhereSpan(
  sql: string
): { start: number; end: number; body: string } | null {
  const re = new RegExp(
    `\\bWHERE\\b\\s+([\\s\\S]*?)(?=\\b(?:${CLAUSE_STOP_WORDS})\\b|;|$)`,
    'i'
  )
  const match = re.exec(sql)
  if (!match || match.index === undefined) return null
  return {
    start: match.index,
    end: match.index + match[0].length,
    body: match[1].trim(),
  }
}

/** Pick the best PREWHERE candidate: prefer equality/IN (typically most selective) on a below-average-size column; fall back to any predicate. */
function pickPrewhereCandidate(ctx: QueryContext): SqlPredicate | null {
  if (ctx.predicates.length === 0) return null

  const avgCompressedBytes =
    ctx.schema.columns.length > 0
      ? ctx.schema.columns.reduce((sum, c) => sum + c.compressedBytes, 0) /
        ctx.schema.columns.length
      : 0

  const isCheap = (column: string): boolean => {
    if (avgCompressedBytes <= 0) return true
    const stat = ctx.schema.columns.find((c) => c.name === column)
    return !stat || stat.compressedBytes <= avgCompressedBytes
  }

  const ranked = [...ctx.predicates].sort((a, b) => {
    const aScore = (a.isEqualityOrIn ? 0 : 1) + (isCheap(a.column) ? 0 : 2)
    const bScore = (b.isEqualityOrIn ? 0 : 1) + (isCheap(b.column) ? 0 : 2)
    return aScore - bScore
  })

  return ranked[0] ?? null
}

export interface PrewhereRewrite {
  rewrittenSql: string
  movedPredicate: SqlPredicate
}

/**
 * Propose moving the most selective/cheap WHERE predicate into PREWHERE.
 * Returns `null` when there's no WHERE clause to rewrite, no predicate the
 * engine recognizes, or the WHERE body can't be confidently segmented (e.g.
 * a single complex boolean expression) — never guesses at a rewrite it isn't
 * confident produces equivalent, valid SQL.
 */
export function proposePrewhereRewrite(
  ctx: QueryContext
): PrewhereRewrite | null {
  const span = findWhereSpan(ctx.sql)
  if (!span || !span.body) return null

  const candidate = pickPrewhereCandidate(ctx)
  if (!candidate) return null

  const conditions = splitTopLevelAnd(span.body)
  const matchIndex = conditions.findIndex((cond) =>
    new RegExp(
      `(^|\\.|\\s)${candidate.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(=|!=|<>|<=|>=|<|>|\\bIN\\b|\\bBETWEEN\\b|\\bLIKE\\b|\\bILIKE\\b)`,
      'i'
    ).test(cond)
  )
  if (matchIndex === -1) return null

  const movedCondition = conditions[matchIndex]
  const remaining = conditions.filter((_, i) => i !== matchIndex)

  const replacement = `PREWHERE ${movedCondition}${remaining.length > 0 ? ` WHERE ${remaining.join(' AND ')}` : ''}`
  const rewrittenSql =
    ctx.sql.slice(0, span.start) + replacement + ctx.sql.slice(span.end)

  return { rewrittenSql, movedPredicate: candidate }
}
