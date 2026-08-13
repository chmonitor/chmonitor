import {
  extractReferencedTables,
  formatQualifiedTable,
  normalizeIdentifier,
  quoteIdentifier,
  type ReferencedTable,
} from '@chm/query-advisor-core'
import { validateSqlQuery } from '@chm/sql-builder'

// Re-exported so existing `from './sql-analysis'` imports (tests, tool
// wiring) keep working unchanged — these are pure parsing helpers now shared
// via `@chm/query-advisor-core` (see recommendation-engine.ts for the same
// pattern).
export {
  extractReferencedTables,
  formatQualifiedTable,
  quoteIdentifier,
  type ReferencedTable,
}

export interface ReferencedColumn {
  name: string
  count: number
}

const WHERE_COLUMN_PATTERN =
  /\b(?:WHERE|AND|OR|PREWHERE|ON)\s+(?:\w+\.)?(`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)\s*(?:=|!=|<>|<|>|<=|>=|\bIN\b|\bLIKE\b|\bILIKE\b|\bBETWEEN\b)/gi

const AGGREGATION_PATTERN =
  /\b(count|sum|avg|min|max|uniq|quantile|median|groupArray|groupUniqArray)\s*\(/i

const LIMIT_PATTERN = /\bLIMIT\s+\d+/i
const GROUP_BY_PATTERN = /\bGROUP\s+BY\b/i

export function validateAgentSql(sql: string): string {
  const trimmed = sql.trim().replace(/;+$/g, '')
  validateSqlQuery(trimmed)
  return trimmed
}

export function extractWhereColumns(sql: string): ReferencedColumn[] {
  const counts = new Map<string, number>()

  for (const match of sql.matchAll(WHERE_COLUMN_PATTERN)) {
    const column = normalizeIdentifier(match[1])
    if (!column) continue
    counts.set(column, (counts.get(column) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function hasLimit(sql: string): boolean {
  return LIMIT_PATTERN.test(sql)
}

export function hasAggregation(sql: string): boolean {
  return AGGREGATION_PATTERN.test(sql) || GROUP_BY_PATTERN.test(sql)
}

export function isLikelyExploratorySelect(sql: string): boolean {
  const upper = sql.trim().toUpperCase()
  return (
    upper.startsWith('SELECT') &&
    !hasLimit(sql) &&
    !hasAggregation(sql) &&
    !upper.includes(' FORMAT ')
  )
}

export function scoreOrderByCandidate(columnName: string): number {
  const lower = columnName.toLowerCase()
  if (
    /(tenant|team|org|workspace|project|account|status|type|kind|level|country|region|env)/.test(
      lower
    )
  ) {
    return 10
  }
  if (/(date|day|month|hour)/.test(lower)) return 20
  if (/(time|timestamp|created|updated|event_time)/.test(lower)) return 30
  if (/(user|customer|session|device|host)/.test(lower)) return 40
  if (/(uuid|query_id|trace_id|span_id|event_id|id)$/.test(lower)) return 90
  return 50
}
