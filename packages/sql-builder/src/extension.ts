/**
 * SQL Builder Extension System
 *
 * Enables version-aware query building where newer ClickHouse versions
 * can extend base queries with modifications. Supports unlimited extension
 * depth for version inheritance chains.
 *
 * @example
 * ```typescript
 * // Base query for v23
 * const v23 = sql
 *   .select('query', 'user', 'memory_usage')
 *   .from('system.processes')
 *
 * // v24: Add new column + filter
 * const v24 = v23
 *   .extend()
 *   .addColumn('peak_threads_usage')
 *   .addWhere('peak_threads_usage', '>', 0)
 *
 * // v25: Chain from v24
 * const v25 = v24
 *   .extend()
 *   .addColumn('hostname')
 *   .changeOrderBy('memory_usage', 'DESC')
 * ```
 */

import type {
  BuilderState,
  JoinType,
  SqlBuilderLike,
  SqlCondition,
  SqlExpression,
  SqlJoin,
  SqlValue,
} from './types'

import { renderExtendedQuery } from './render'
import { validateBuilderState } from './validator'

/**
 * Modification operation types for tracking changes to base queries
 */
type Modification =
  | { type: 'addColumn'; column: SqlExpression; options?: { after?: string } }
  | { type: 'removeColumn'; column: string }
  | { type: 'replaceColumn'; oldColumn: string; newColumn: SqlExpression }
  | { type: 'addWhere'; column: string; operator: string; value: SqlValue }
  | { type: 'removeWhere'; column: string; operator: string; value: SqlValue }
  | { type: 'changeOrderBy'; column: string; direction?: 'ASC' | 'DESC' }
  | { type: 'addOrderBy'; column: string; direction?: 'ASC' | 'DESC' }
  | { type: 'removeOrderBy'; column: string }
  | {
      type: 'addJoin'
      joinType: JoinType
      table: string
      alias: string
      condition: string | { using: string[] }
    }
  | { type: 'removeJoin'; alias: string }

/**
 * Extended SQL Builder with modification capabilities
 *
 * Provides immutable modification API for extending base queries.
 * All methods return new instances, allowing unlimited extension depth.
 *
 * @example
 * ```typescript
 * const extended = baseQuery
 *   .extend()
 *   .addColumn('new_column')
 *   .addWhere('status', '=', 'active')
 *   .changeOrderBy('created_at', 'DESC')
 *
 * const sql = extended.build()
 * ```
 */
export class ExtendedBuilder {
  private baseBuilder: SqlBuilderLike
  private modifications: Modification[]

  /**
   * Creates a new ExtendedBuilder
   *
   * @param base - The base SqlBuilder to extend
   * @param modifications - Existing modifications (for chaining)
   */
  constructor(base: SqlBuilderLike, modifications: Modification[] = []) {
    this.baseBuilder = base
    this.modifications = modifications
  }

  // ============================================================================
  // Column Modifications
  // ============================================================================

  /**
   * Adds a column to the SELECT clause
   *
   * @param column - Column expression to add
   * @param options - Optional placement options
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.addColumn('hostname')
   * builder.addColumn(col('COUNT(*)', 'total'))
   * builder.addColumn('new_column', { after: 'existing_column' })
   * ```
   */
  addColumn(
    column: SqlExpression,
    options?: { after?: string }
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'addColumn', column, options },
    ])
  }

  /**
   * Removes a column from the SELECT clause
   *
   * @param column - Column name or alias to remove
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.removeColumn('deprecated_column')
   * ```
   */
  removeColumn(column: string): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'removeColumn', column },
    ])
  }

  /**
   * Replaces an existing column with a new expression
   *
   * @param oldColumn - Column name to replace
   * @param newColumn - New column expression
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.replaceColumn('old_name', 'new_name')
   * builder.replaceColumn('count', col('COUNT(*)', 'total_count'))
   * ```
   */
  replaceColumn(oldColumn: string, newColumn: SqlExpression): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'replaceColumn', oldColumn, newColumn },
    ])
  }

  // ============================================================================
  // WHERE Modifications
  // ============================================================================

  /**
   * Adds a WHERE condition (AND logic)
   *
   * @param column - Column name
   * @param operator - Comparison operator
   * @param value - Value to compare
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.addWhere('status', '=', 'active')
   * builder.addWhere('created_at', '>', '2024-01-01')
   * ```
   */
  addWhere(column: string, operator: string, value: SqlValue): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'addWhere', column, operator, value },
    ])
  }

  /**
   * Removes a WHERE condition
   *
   * @param column - Column name
   * @param operator - Comparison operator
   * @param value - Value to match
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.removeWhere('is_deleted', '=', 0)
   * ```
   */
  removeWhere(
    column: string,
    operator: string,
    value: SqlValue
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'removeWhere', column, operator, value },
    ])
  }

  // ============================================================================
  // ORDER BY Modifications
  // ============================================================================

  /**
   * Changes the ORDER BY direction for a column
   *
   * Replaces existing ORDER BY for the column or adds new one.
   *
   * @param column - Column name
   * @param direction - Sort direction (default: ASC)
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.changeOrderBy('created_at', 'DESC')
   * builder.changeOrderBy('name') // ASC by default
   * ```
   */
  changeOrderBy(
    column: string,
    direction: 'ASC' | 'DESC' = 'ASC'
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'changeOrderBy', column, direction },
    ])
  }

  /**
   * Adds an ORDER BY clause
   *
   * @param column - Column name
   * @param direction - Sort direction (default: ASC)
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.addOrderBy('priority', 'DESC')
   * builder.addOrderBy('name')
   * ```
   */
  addOrderBy(
    column: string,
    direction: 'ASC' | 'DESC' = 'ASC'
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'addOrderBy', column, direction },
    ])
  }

  /**
   * Removes an ORDER BY clause for a column
   *
   * @param column - Column name to remove from ORDER BY
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.removeOrderBy('deprecated_sort')
   * ```
   */
  removeOrderBy(column: string): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'removeOrderBy', column },
    ])
  }

  // ============================================================================
  // JOIN Modifications
  // ============================================================================

  /**
   * Adds an INNER JOIN
   *
   * @param table - Table name to join
   * @param alias - Table alias
   * @param condition - Join condition (ON clause) or USING clause
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.addJoin('users', 'u', 'u.id = t.user_id')
   * builder.addJoin('users', 'u', { using: ['user_id'] })
   * ```
   */
  addJoin(
    table: string,
    alias: string,
    condition: string | { using: string[] }
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'addJoin', joinType: 'INNER', table, alias, condition },
    ])
  }

  /**
   * Adds a LEFT JOIN
   *
   * @param table - Table name to join
   * @param alias - Table alias
   * @param condition - Join condition (ON clause) or USING clause
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.addLeftJoin('profiles', 'p', 'p.user_id = u.id')
   * builder.addLeftJoin('profiles', 'p', { using: ['user_id'] })
   * ```
   */
  addLeftJoin(
    table: string,
    alias: string,
    condition: string | { using: string[] }
  ): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'addJoin', joinType: 'LEFT', table, alias, condition },
    ])
  }

  /**
   * Removes a JOIN by alias
   *
   * @param alias - Table alias to remove
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * builder.removeJoin('deprecated_table_alias')
   * ```
   */
  removeJoin(alias: string): ExtendedBuilder {
    return new ExtendedBuilder(this.baseBuilder, [
      ...this.modifications,
      { type: 'removeJoin', alias },
    ])
  }

  // ============================================================================
  // Extension Chaining
  // ============================================================================

  /**
   * Creates a new ExtendedBuilder extending this one
   *
   * Allows unlimited extension depth: v25 = v24.extend() = v23.extend().extend()
   *
   * @returns New ExtendedBuilder instance
   *
   * @example
   * ```typescript
   * const v24 = v23.extend().addColumn('new_col')
   * const v25 = v24.extend().addColumn('another_col')
   * const v26 = v25.extend().removeColumn('old_col')
   * ```
   */
  extend(): ExtendedBuilder {
    // Create a virtual builder that represents the current state
    const virtualBuilder: SqlBuilderLike = {
      state: this.getModifiedState(),
      build: () => this.build(),
      buildPretty: () => this.buildPretty(),
    }
    return new ExtendedBuilder(virtualBuilder, [])
  }

  // ============================================================================
  // Build Methods
  // ============================================================================

  /**
   * Builds the final SQL query with all modifications applied
   *
   * @returns SQL query string
   * @throws {SqlBuilderError} If builder state is invalid
   *
   * @example
   * ```typescript
   * const sql = builder.build()
   * console.log(sql) // SELECT ... FROM ... WHERE ...
   * ```
   */
  build(): string {
    const state = this.getModifiedState()
    validateBuilderState(state)
    return renderExtendedQuery(state)
  }

  /**
   * Builds formatted SQL with indentation
   *
   * @returns Formatted SQL query string
   * @throws {SqlBuilderError} If builder state is invalid
   *
   * @example
   * ```typescript
   * console.log(builder.buildPretty())
   * // SELECT
   * //   column1,
   * //   column2
   * // FROM table
   * // WHERE condition = value
   * ```
   */
  buildPretty(): string {
    const state = this.getModifiedState()
    validateBuilderState(state)
    return renderExtendedQuery(state, true)
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Applies all modifications to base state
   *
   * @returns Modified builder state
   */
  private getModifiedState(): BuilderState {
    // Clone the base state
    let state: BuilderState = this.cloneState(this.baseBuilder.state)

    // Apply each modification in sequence
    for (const mod of this.modifications) {
      state = this.applyModification(state, mod)
    }

    return state
  }

  /**
   * Deep clones builder state
   */
  private cloneState(state: BuilderState): BuilderState {
    return {
      ctes: [...state.ctes],
      columns: [...state.columns],
      from: state.from ? { ...state.from } : undefined,
      joins: state.joins.map((j) => ({ ...j })),
      wheres: [...state.wheres],
      groupBy: [...state.groupBy],
      having: [...state.having],
      orderBy: state.orderBy.map((o) => ({ ...o })),
      limit: state.limit,
      offset: state.offset,
      unions: [...state.unions],
      settings: { ...state.settings },
      format: state.format,
    }
  }

  /**
   * Applies a single modification to state
   */
  private applyModification(
    state: BuilderState,
    mod: Modification
  ): BuilderState {
    switch (mod.type) {
      case 'addColumn': {
        const newColumns = [...state.columns]
        if (mod.options?.after) {
          const afterIndex = this.findColumnIndex(newColumns, mod.options.after)
          if (afterIndex >= 0) {
            newColumns.splice(afterIndex + 1, 0, mod.column)
          } else {
            newColumns.push(mod.column)
          }
        } else {
          newColumns.push(mod.column)
        }
        return { ...state, columns: newColumns }
      }

      case 'removeColumn': {
        const newColumns = state.columns.filter(
          (col) => this.getColumnIdentifier(col) !== mod.column
        )
        return { ...state, columns: newColumns }
      }

      case 'replaceColumn': {
        const newColumns = state.columns.map((col) =>
          this.getColumnIdentifier(col) === mod.oldColumn ? mod.newColumn : col
        )
        return { ...state, columns: newColumns }
      }

      case 'addWhere': {
        const condition: SqlCondition = {
          column: mod.column,
          operator: mod.operator,
          value: mod.value,
          type: 'and',
        }
        return { ...state, wheres: [...state.wheres, condition] }
      }

      case 'removeWhere': {
        const newWheres = state.wheres.filter((w) => {
          if ('conditions' in w) return true // Keep groups
          return !(
            w.column === mod.column &&
            w.operator === mod.operator &&
            w.value === mod.value
          )
        })
        return { ...state, wheres: newWheres }
      }

      case 'changeOrderBy': {
        const newOrderBy = state.orderBy.filter((o) => o.column !== mod.column)
        newOrderBy.push({
          column: mod.column,
          direction: mod.direction ?? 'ASC',
        })
        return { ...state, orderBy: newOrderBy }
      }

      case 'addOrderBy': {
        const exists = state.orderBy.some((o) => o.column === mod.column)
        if (exists) {
          return state // Don't add duplicate
        }
        return {
          ...state,
          orderBy: [
            ...state.orderBy,
            { column: mod.column, direction: mod.direction ?? 'ASC' },
          ],
        }
      }

      case 'removeOrderBy': {
        return {
          ...state,
          orderBy: state.orderBy.filter((o) => o.column !== mod.column),
        }
      }

      case 'addJoin': {
        const join: SqlJoin = {
          type: mod.joinType,
          table: mod.table,
          alias: mod.alias,
        }
        if (typeof mod.condition === 'string') {
          join.condition = mod.condition
        } else {
          join.using = mod.condition.using
        }
        return { ...state, joins: [...state.joins, join] }
      }

      case 'removeJoin': {
        return {
          ...state,
          joins: state.joins.filter((j) => j.alias !== mod.alias),
        }
      }

      default:
        return state
    }
  }

  /**
   * Finds column index by name or alias
   */
  private findColumnIndex(columns: SqlExpression[], name: string): number {
    return columns.findIndex((col) => this.getColumnIdentifier(col) === name)
  }

  /**
   * Extracts column identifier (name or alias)
   */
  private getColumnIdentifier(column: SqlExpression): string {
    if (typeof column === 'string') {
      return column
    }
    // SqlFragment type
    if ('alias' in column && typeof (column as any).alias === 'string') {
      return (column as any).alias as string
    }
    if (
      'expression' in column &&
      typeof (column as any).expression === 'string'
    ) {
      return (column as any).expression as string
    }
    if ('sql' in column && typeof (column as any).sql === 'string') {
      return (column as any).sql as string
    }
    return String(column)
  }
}
