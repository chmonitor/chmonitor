/**
 * Column Builder
 *
 * Provides fluent API for building column expressions with
 * ClickHouse-specific formatting and window functions.
 */

import type { SqlFragment, WindowOptions } from './types'

import { RawSql } from './raw'

/**
 * Builder for column expressions with ClickHouse helpers
 *
 * All methods return new instances for immutability.
 *
 * @example
 * ```typescript
 * col('bytes').readable()
 * // → "formatReadableSize(bytes) AS readable_bytes"
 *
 * col('elapsed').pctOfMax()
 * // → "round(100 * elapsed / max(elapsed) OVER (), 2) AS pct_elapsed"
 * ```
 */
export class ColumnBuilder implements SqlFragment {
  private column: string
  private _alias?: string
  private expression?: string

  constructor(
    column: string,
    options?: { alias?: string; expression?: string }
  ) {
    this.column = column
    this._alias = options?.alias
    this.expression = options?.expression
  }

  /**
   * Set an alias for the column
   *
   * @param alias - Alias name
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('user_id').as('uid')
   * // → "user_id AS uid"
   * ```
   */
  as(alias: string): ColumnBuilder {
    return new ColumnBuilder(this.column, {
      alias,
      expression: this.expression,
    })
  }

  /**
   * Format bytes as human-readable size
   *
   * Auto-generates alias: readable_{column}
   *
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('bytes').readable()
   * // → "formatReadableSize(bytes) AS readable_bytes"
   * ```
   */
  readable(): ColumnBuilder {
    const expr = this.expression || this.column
    return new ColumnBuilder(this.column, {
      alias: this._alias || `readable_${this.column}`,
      expression: `formatReadableSize(${expr})`,
    })
  }

  /**
   * Format number as human-readable quantity
   *
   * Auto-generates alias: readable_{column}
   *
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('rows').quantity()
   * // → "formatReadableQuantity(rows) AS readable_rows"
   * ```
   */
  quantity(): ColumnBuilder {
    const expr = this.expression || this.column
    return new ColumnBuilder(this.column, {
      alias: this._alias || `readable_${this.column}`,
      expression: `formatReadableQuantity(${expr})`,
    })
  }

  /**
   * Format seconds as human-readable time delta
   *
   * Auto-generates alias: readable_{column}
   *
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('elapsed').timeDelta()
   * // → "formatReadableTimeDelta(elapsed) AS readable_elapsed"
   * ```
   */
  timeDelta(): ColumnBuilder {
    const expr = this.expression || this.column
    return new ColumnBuilder(this.column, {
      alias: this._alias || `readable_${this.column}`,
      expression: `formatReadableTimeDelta(${expr})`,
    })
  }

  /**
   * Calculate percentage of max value
   *
   * Auto-generates alias: pct_{column}
   *
   * @param precision - Decimal places (default: 2)
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('elapsed').pctOfMax()
   * // → "round(100 * elapsed / max(elapsed) OVER (), 2) AS pct_elapsed"
   * ```
   */
  pctOfMax(precision = 2): ColumnBuilder {
    const expr = this.expression || this.column
    return new ColumnBuilder(this.column, {
      alias: this._alias || `pct_${this.column}`,
      expression: `round(100 * ${expr} / max(${expr}) OVER (), ${precision})`,
    })
  }

  /**
   * Add window function clause
   *
   * @param opts - Window options
   * @returns New ColumnBuilder instance
   *
   * @example
   * ```typescript
   * col('elapsed').over({ partitionBy: 'user', orderBy: 'event_time DESC' })
   * // → "elapsed OVER (PARTITION BY user ORDER BY event_time DESC)"
   * ```
   */
  over(opts: WindowOptions): ColumnBuilder {
    const expr = this.expression || this.column
    const parts: string[] = []

    if (opts.partitionBy) {
      const partitions = Array.isArray(opts.partitionBy)
        ? opts.partitionBy.join(', ')
        : opts.partitionBy
      parts.push(`PARTITION BY ${partitions}`)
    }

    if (opts.orderBy) {
      parts.push(`ORDER BY ${opts.orderBy}`)
    }

    const windowClause = parts.length > 0 ? ` (${parts.join(' ')})` : ' ()'
    return new ColumnBuilder(this.column, {
      alias: this._alias,
      expression: `${expr} OVER${windowClause}`,
    })
  }

  /**
   * Convert to SQL string
   *
   * @returns SQL expression
   */
  toSql(): string {
    const expr = this.expression || this.column
    return this._alias ? `${expr} AS ${this._alias}` : expr
  }
}

/**
 * Create a new column builder
 *
 * @param column - Column name
 * @returns ColumnBuilder instance
 *
 * @example
 * ```typescript
 * col('bytes').readable()
 * col('elapsed').pctOfMax()
 * ```
 */
export function col(column: string): ColumnBuilder {
  return new ColumnBuilder(column)
}

/**
 * Concatenate strings and column values
 *
 * String literals are automatically escaped and quoted.
 * For raw SQL expressions (like column names), wrap in `new RawSql(expr)`.
 *
 * @param parts - String parts or RawSql objects to concatenate
 * @returns ColumnBuilder with concat expression
 *
 * @example
 * ```typescript
 * // All quoted (literals)
 * col.concat('database', '.', 'table').as('full_name')
 * // → "concat('database', '.', 'table') AS full_name"
 *
 * // Mix literals and column references
 * col.concat(new RawSql('database'), '.', new RawSql('table')).as('full_name')
 * // → "concat(database, '.', table) AS full_name"
 * ```
 */
col.concat = (...parts: Array<string | RawSql>): ColumnBuilder => {
  const escapeLiteral = (value: string): string => value.replace(/'/g, "''")
  const quotedParts = parts.map((p) => {
    if (p instanceof RawSql) {
      return p.toSql()
    }
    return `'${escapeLiteral(p)}'`
  })
  return new ColumnBuilder('concat', {
    expression: `concat(${quotedParts.join(', ')})`,
  })
}

/**
 * Sum aggregate function
 *
 * @param column - Column to sum
 * @returns ColumnBuilder with sum expression
 *
 * @example
 * ```typescript
 * col.sum('bytes').as('total_bytes')
 * // → "sum(bytes) AS total_bytes"
 * ```
 */
col.sum = (column: string): ColumnBuilder => {
  return new ColumnBuilder(column, {
    expression: `sum(${column})`,
  })
}

/**
 * Count aggregate function
 *
 * @param column - Column to count (optional, defaults to *)
 * @returns ColumnBuilder with count expression
 *
 * @example
 * ```typescript
 * col.count().as('total')
 * // → "count() AS total"
 *
 * col.count('user_id').as('user_count')
 * // → "count(user_id) AS user_count"
 * ```
 */
col.count = (column?: string): ColumnBuilder => {
  return new ColumnBuilder(column || '*', {
    expression: column ? `count(${column})` : 'count()',
  })
}

/**
 * Average aggregate function
 *
 * @param column - Column to average
 * @returns ColumnBuilder with avg expression
 *
 * @example
 * ```typescript
 * col.avg('duration').as('avg_duration')
 * // → "avg(duration) AS avg_duration"
 * ```
 */
col.avg = (column: string): ColumnBuilder => {
  return new ColumnBuilder(column, {
    expression: `avg(${column})`,
  })
}

/**
 * Max aggregate function
 *
 * @param column - Column to find max
 * @returns ColumnBuilder with max expression
 *
 * @example
 * ```typescript
 * col.max('bytes').as('max_bytes')
 * // → "max(bytes) AS max_bytes"
 * ```
 */
col.max = (column: string): ColumnBuilder => {
  return new ColumnBuilder(column, {
    expression: `max(${column})`,
  })
}

/**
 * Min aggregate function
 *
 * @param column - Column to find min
 * @returns ColumnBuilder with min expression
 *
 * @example
 * ```typescript
 * col.min('bytes').as('min_bytes')
 * // → "min(bytes) AS min_bytes"
 * ```
 */
col.min = (column: string): ColumnBuilder => {
  return new ColumnBuilder(column, {
    expression: `min(${column})`,
  })
}
