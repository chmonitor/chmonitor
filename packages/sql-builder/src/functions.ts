/**
 * SQL Function Helpers
 *
 * Namespace for common ClickHouse SQL functions.
 * All functions return SQL expression strings.
 */

/**
 * SQL function helpers for ClickHouse
 *
 * @example
 * ```typescript
 * fn.readableSize('bytes')
 * // → "formatReadableSize(bytes)"
 *
 * fn.pctOfMax('elapsed', 2)
 * // → "round(100 * elapsed / max(elapsed) OVER (), 2)"
 * ```
 */
export const fn = {
  /**
   * Format bytes as human-readable size
   *
   * @param column - Column name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.readableSize('bytes')
   * // → "formatReadableSize(bytes)"
   * ```
   */
  readableSize(column: string): string {
    return `formatReadableSize(${column})`
  },

  /**
   * Format number as human-readable quantity
   *
   * @param column - Column name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.readableQuantity('rows')
   * // → "formatReadableQuantity(rows)"
   * ```
   */
  readableQuantity(column: string): string {
    return `formatReadableQuantity(${column})`
  },

  /**
   * Format seconds as human-readable time delta
   *
   * @param column - Column name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.readableTimeDelta('elapsed')
   * // → "formatReadableTimeDelta(elapsed)"
   * ```
   */
  readableTimeDelta(column: string): string {
    return `formatReadableTimeDelta(${column})`
  },

  /**
   * Sum aggregate function
   *
   * @param column - Column to sum
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.sum('bytes')
   * // → "sum(bytes)"
   * ```
   */
  sum(column: string): string {
    return `sum(${column})`
  },

  /**
   * Count aggregate function
   *
   * @param column - Column to count (optional, defaults to *)
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.count()
   * // → "count()"
   *
   * fn.count('user_id')
   * // → "count(user_id)"
   * ```
   */
  count(column?: string): string {
    return column ? `count(${column})` : 'count()'
  },

  /**
   * Average aggregate function
   *
   * @param column - Column to average
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.avg('duration')
   * // → "avg(duration)"
   * ```
   */
  avg(column: string): string {
    return `avg(${column})`
  },

  /**
   * Max aggregate function
   *
   * @param column - Column to find max
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.max('bytes')
   * // → "max(bytes)"
   * ```
   */
  max(column: string): string {
    return `max(${column})`
  },

  /**
   * Min aggregate function
   *
   * @param column - Column to find min
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.min('bytes')
   * // → "min(bytes)"
   * ```
   */
  min(column: string): string {
    return `min(${column})`
  },

  /**
   * Calculate percentage of max value using window function
   *
   * @param column - Column name
   * @param precision - Decimal places (default: 2)
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.pctOfMax('elapsed')
   * // → "round(100 * elapsed / max(elapsed) OVER (), 2)"
   *
   * fn.pctOfMax('bytes', 1)
   * // → "round(100 * bytes / max(bytes) OVER (), 1)"
   * ```
   */
  pctOfMax(column: string, precision = 2): string {
    return `round(100 * ${column} / max(${column}) OVER (), ${precision})`
  },

  /**
   * Access ProfileEvents array element
   *
   * @param name - Event name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.profileEvent('MemoryUsage')
   * // → "ProfileEvents['MemoryUsage']"
   * ```
   */
  profileEvent(name: string): string {
    return `ProfileEvents['${name}']`
  },

  /**
   * Convert to Date type
   *
   * @param column - Column name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.toDate('event_time')
   * // → "toDate(event_time)"
   * ```
   */
  toDate(column: string): string {
    return `toDate(${column})`
  },

  /**
   * Convert to DateTime type
   *
   * @param column - Column name
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.toDateTime('event_time')
   * // → "toDateTime(event_time)"
   * ```
   */
  toDateTime(column: string): string {
    return `toDateTime(${column})`
  },

  /**
   * Get current date
   *
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.today()
   * // → "today()"
   * ```
   */
  today(): string {
    return 'today()'
  },

  /**
   * Get current datetime
   *
   * @returns SQL expression
   *
   * @example
   * ```typescript
   * fn.now()
   * // → "now()"
   * ```
   */
  now(): string {
    return 'now()'
  },
}
