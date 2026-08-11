/**
 * PREWHERE rewrite rule for the query advisor (see `../../advisor.ts`
 * header for the duplication note this whole `advisor/` tree inherits).
 */

import type { QueryContext, SqlPredicate } from '../types'

import { findWhereSpan, splitTopLevelAnd } from '../sql-parse'

export function pickPrewhereCandidate(ctx: QueryContext): SqlPredicate | null {
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

export function proposePrewhereRewrite(
  ctx: QueryContext
): { rewrittenSql: string; movedPredicate: SqlPredicate } | null {
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
