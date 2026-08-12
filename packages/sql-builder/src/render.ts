/**
 * SQL Rendering Engine
 *
 * Turns a {@link BuilderState} into SQL text. This is the single home for SQL
 * string generation: {@link SqlBuilder} (fluent API) and {@link ExtendedBuilder}
 * (version-aware modifications) both own state and delegate rendering here.
 *
 * Two engines live here on purpose — they are NOT interchangeable:
 *
 * - {@link renderQuery} is the canonical engine used by `SqlBuilder`. It
 *   supports every clause and escapes values.
 * - {@link renderExtendedQuery} is the simplified engine used by
 *   `ExtendedBuilder`. It predates this module and its output is pinned by
 *   `__tests__/extension.test.ts`.
 *
 * Divergences of `renderExtendedQuery` from `renderQuery` (all intentional,
 * all covered by existing tests):
 *
 * | Clause     | renderQuery                              | renderExtendedQuery                        |
 * |------------|------------------------------------------|--------------------------------------------|
 * | WITH (CTE) | rendered                                 | dropped                                     |
 * | SELECT     | `toSql()` on fragments, `*` when empty   | `toString()` on fragments, no `*` fallback  |
 * | SELECT fmt | one line: `SELECT a, b`                  | one column per line when pretty             |
 * | FROM       | subquery → `(<sql>)`                     | subquery → literal `subquery`               |
 * | JOIN       | USING wins over ON; subquery → `(<sql>)` | ON wins over USING; subquery → `subquery`   |
 * | WHERE      | AND/OR honored, groups recursed          | always AND, groups → `(...)`                |
 * | values     | quotes escaped, booleans → `1`/`0`       | quotes not escaped, booleans → `true`/`false` |
 * | ORDER BY   | raw fragments emitted verbatim           | `${column} ${direction}` for every entry    |
 * | UNION      | rendered                                 | dropped                                     |
 * | SETTINGS   | rendered                                 | dropped                                     |
 *
 * Neither engine validates: callers run `validateBuilderState` first.
 */

import type {
  BuilderState,
  SqlBuilderLike,
  SqlCondition,
  SqlExpression,
  SqlJoin,
  SqlOrder,
  WhereGroup,
} from './types'

// ============================================================================
// Canonical engine (SqlBuilder)
// ============================================================================

/**
 * Renders a full SQL query from builder state
 *
 * @param state - Builder state to render
 * @param pretty - Use newlines and indentation
 */
export function renderQuery(state: BuilderState, pretty: boolean): string {
  const nl = pretty ? '\n' : ' '
  const indent = pretty ? '  ' : ''
  const parts: string[] = []

  // WITH (CTEs)
  if (state.ctes.length > 0) {
    const ctes = state.ctes
      .map((cte) => `${cte.name} AS (${cte.query.build()})`)
      .join(`, ${nl}${indent}`)
    parts.push(`WITH ${ctes}`)
  }

  // SELECT
  const columns =
    state.columns.length > 0
      ? state.columns.map((col) => formatExpression(col)).join(', ')
      : '*'
  parts.push(`SELECT ${columns}`)

  // FROM
  if (state.from) {
    const fromClause = formatFrom(state.from)
    parts.push(`FROM ${fromClause}`)
  }

  // JOINs
  for (const join of state.joins) {
    parts.push(formatJoin(join))
  }

  // WHERE
  if (state.wheres.length > 0) {
    const whereClause = formatConditions(state.wheres)
    parts.push(`WHERE ${whereClause}`)
  }

  // GROUP BY
  if (state.groupBy.length > 0) {
    parts.push(`GROUP BY ${state.groupBy.join(', ')}`)
  }

  // HAVING
  if (state.having.length > 0) {
    const havingClause = formatConditions(state.having)
    parts.push(`HAVING ${havingClause}`)
  }

  // ORDER BY
  if (state.orderBy.length > 0) {
    const orders = state.orderBy.map((order) => formatOrder(order))
    parts.push(`ORDER BY ${orders.join(', ')}`)
  }

  // LIMIT
  if (state.limit !== undefined) {
    parts.push(`LIMIT ${state.limit}`)
  }

  // OFFSET
  if (state.offset !== undefined) {
    parts.push(`OFFSET ${state.offset}`)
  }

  // UNION
  let query = parts.join(nl)
  for (const union of state.unions) {
    const unionType = union.all ? 'UNION ALL' : 'UNION'
    query += `${nl}${unionType}${nl}${union.query.build()}`
  }

  // SETTINGS
  if (Object.keys(state.settings).length > 0) {
    const settings = Object.entries(state.settings)
      .map(([key, value]) => `${key} = ${formatValue(value)}`)
      .join(', ')
    query += `${nl}SETTINGS ${settings}`
  }

  // FORMAT
  if (state.format) {
    query += `${nl}FORMAT ${state.format}`
  }

  return query
}

/**
 * Format expression (column, raw SQL, etc.)
 */
function formatExpression(expr: SqlExpression): string {
  if (typeof expr === 'string') {
    return expr
  }
  // SqlFragment (RawSql, ColumnBuilder, etc.)
  return expr.toSql()
}

/**
 * Format FROM clause
 */
function formatFrom(from: {
  table: string | SqlBuilderLike
  alias?: string
}): string {
  let result: string

  if (typeof from.table === 'string') {
    result = from.table
  } else {
    result = `(${from.table.build()})`
  }

  if (from.alias) {
    result += ` AS ${from.alias}`
  }

  return result
}

/**
 * Format JOIN clause
 */
function formatJoin(join: SqlJoin): string {
  let result = `${join.type} JOIN `

  if (typeof join.table === 'string') {
    result += join.table
  } else {
    result += `(${join.table.build()})`
  }

  if (join.alias) {
    result += ` AS ${join.alias}`
  }

  if (join.using) {
    result += ` USING (${join.using.join(', ')})`
  } else if (join.condition) {
    result += ` ON ${join.condition}`
  }

  return result
}

/**
 * Format conditions (WHERE/HAVING)
 */
function formatConditions(
  conditions: (SqlCondition | WhereGroup)[],
  level = 0
): string {
  const parts: string[] = []

  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i]
    const isFirst = i === 0

    if ('conditions' in condition) {
      // WhereGroup
      const grouped = formatConditions(condition.conditions, level + 1)
      const connector = isFirst ? '' : ` ${condition.type.toUpperCase()} `
      parts.push(`${connector}(${grouped})`)
    } else {
      // SqlCondition
      const connector = isFirst ? '' : ` ${condition.type.toUpperCase()} `

      // Raw SQL condition
      if (
        condition.value &&
        typeof condition.value === 'object' &&
        'toSql' in condition.value
      ) {
        parts.push(`${connector}${condition.value.toSql()}`)
      } else {
        // Regular condition
        const value = formatValue(condition.value)
        parts.push(
          `${connector}${condition.column} ${condition.operator} ${value}`
        )
      }
    }
  }

  return parts.join('')
}

/**
 * Format ORDER BY clause
 */
function formatOrder(order: SqlOrder): string {
  let result: string

  if (typeof order.column === 'object') {
    // SqlFragment (RawSql)
    result = order.column.toSql()
  } else {
    result = `${order.column} ${order.direction}`
    if (order.nulls) {
      result += ` NULLS ${order.nulls}`
    }
  }

  return result
}

/**
 * Format value for SQL
 */
function formatValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }
  if (typeof value === 'string') {
    // Escape single quotes
    return `'${value.replace(/'/g, "''")}'`
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'object' && 'toSql' in value) {
    return (value as any).toSql()
  }
  return String(value)
}

// ============================================================================
// Simplified engine (ExtendedBuilder)
// ============================================================================

/**
 * Renders SQL for {@link ExtendedBuilder}
 *
 * Simplified renderer kept for output compatibility — see the divergence table
 * at the top of this file. Do not "fix" it to match {@link renderQuery} without
 * updating `__tests__/extension.test.ts`, which pins this output.
 *
 * @param state - Builder state to render
 * @param pretty - Use newlines and indentation
 */
export function renderExtendedQuery(
  state: BuilderState,
  pretty = false
): string {
  const nl = pretty ? '\n' : ' '
  const indent = pretty ? '  ' : ''
  const parts: string[] = []

  // SELECT
  const columns = state.columns.map((col) => {
    if (typeof col === 'string') return col
    if ('toSql' in col && typeof col.toSql === 'function') {
      return col.toSql()
    }
    return String(col)
  })
  parts.push(`SELECT${nl}${indent}${columns.join(`,${nl}${indent}`)}`)

  // FROM
  if (state.from) {
    const table =
      typeof state.from.table === 'string' ? state.from.table : 'subquery'
    const alias = state.from.alias ? ` AS ${state.from.alias}` : ''
    parts.push(`${nl}FROM ${table}${alias}`)
  }

  // JOINs
  for (const join of state.joins) {
    const table = typeof join.table === 'string' ? join.table : 'subquery'
    const alias = join.alias ? ` AS ${join.alias}` : ''
    let joinClause = `${nl}${join.type} JOIN ${table}${alias}`
    if (join.condition) {
      joinClause += ` ON ${join.condition}`
    } else if (join.using && join.using.length > 0) {
      joinClause += ` USING (${join.using.join(', ')})`
    }
    parts.push(joinClause)
  }

  // WHERE
  if (state.wheres.length > 0) {
    const whereStr = renderExtendedConditions(state.wheres)
    parts.push(`${nl}WHERE ${whereStr}`)
  }

  // GROUP BY
  if (state.groupBy.length > 0) {
    parts.push(`${nl}GROUP BY ${state.groupBy.join(', ')}`)
  }

  // HAVING
  if (state.having.length > 0) {
    const havingStr = renderExtendedConditions(state.having)
    parts.push(`${nl}HAVING ${havingStr}`)
  }

  // ORDER BY
  if (state.orderBy.length > 0) {
    const orderStr = state.orderBy
      .map(
        (o) => `${o.column} ${o.direction}${o.nulls ? ` NULLS ${o.nulls}` : ''}`
      )
      .join(', ')
    parts.push(`${nl}ORDER BY ${orderStr}`)
  }

  // LIMIT/OFFSET
  if (state.limit !== undefined) {
    parts.push(`${nl}LIMIT ${state.limit}`)
  }
  if (state.offset !== undefined) {
    parts.push(`${nl}OFFSET ${state.offset}`)
  }

  // FORMAT
  if (state.format) {
    parts.push(`${nl}FORMAT ${state.format}`)
  }

  return parts.join('')
}

/**
 * Builds WHERE/HAVING conditions string for {@link renderExtendedQuery}
 *
 * Groups collapse to `(...)` and every condition is joined with AND.
 */
function renderExtendedConditions(
  conditions: (SqlCondition | { conditions: unknown[] })[]
): string {
  return conditions
    .map((cond) => {
      if ('conditions' in cond) {
        return '(...)'
      }
      const c = cond as SqlCondition
      const value =
        typeof c.value === 'string' ? `'${c.value}'` : String(c.value)
      return `${c.column} ${c.operator} ${value}`
    })
    .join(' AND ')
}
