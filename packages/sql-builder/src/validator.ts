/**
 * SQL Builder Validation
 *
 * Validates builder state before SQL generation to ensure
 * queries are well-formed and prevent runtime errors.
 */

import type { BuilderState, SqlCondition, SqlJoin, WhereGroup } from './types'

/**
 * Custom error class for SQL builder validation errors
 *
 * @example
 * ```typescript
 * throw new SqlBuilderError(
 *   'Cannot build SQL without FROM clause',
 *   { state: 'missing_from' }
 * )
 * ```
 */
export class SqlBuilderError extends Error {
  constructor(
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SqlBuilderError'
    Object.setPrototypeOf(this, SqlBuilderError.prototype)
  }
}

/**
 * Validates that builder state is complete and correct
 *
 * @param state - The builder state to validate
 * @throws {SqlBuilderError} If validation fails
 *
 * @example
 * ```typescript
 * try {
 *   validateBuilderState(builder.state)
 *   const sql = buildSql(builder.state)
 * } catch (err) {
 *   if (err instanceof SqlBuilderError) {
 *     console.error('Invalid query:', err.message, err.context)
 *   }
 * }
 * ```
 */
export function validateBuilderState(state: BuilderState): void {
  if (!state.from) {
    throw new SqlBuilderError(
      'Cannot build SQL without FROM clause. Call .from() before .build()',
      { state: 'missing_from', hasColumns: state.columns.length > 0 }
    )
  }

  if (state.columns.length === 0) {
    throw new SqlBuilderError(
      'Cannot build SQL without columns. Call .select() before .build()',
      { state: 'missing_select', hasFrom: !!state.from }
    )
  }

  if (state.ctes.length > 0) {
    validateCtes(state.ctes)
  }

  if (state.joins.length > 0) {
    validateJoins(state.joins)
  }

  if (state.wheres.length > 0) {
    validateConditions(state.wheres, 'WHERE')
  }

  if (state.having.length > 0) {
    if (state.groupBy.length === 0) {
      throw new SqlBuilderError(
        'Cannot use HAVING clause without GROUP BY. Add .groupBy() before .having()',
        { state: 'having_without_group_by' }
      )
    }
    validateConditions(state.having, 'HAVING')
  }

  if (state.limit !== undefined) {
    if (state.limit < 0) {
      throw new SqlBuilderError('LIMIT must be a non-negative number', {
        state: 'invalid_limit',
        limit: state.limit,
      })
    }
    if (!Number.isInteger(state.limit)) {
      throw new SqlBuilderError('LIMIT must be an integer', {
        state: 'invalid_limit',
        limit: state.limit,
      })
    }
  }

  if (state.offset !== undefined) {
    if (state.offset < 0) {
      throw new SqlBuilderError('OFFSET must be a non-negative number', {
        state: 'invalid_offset',
        offset: state.offset,
      })
    }
    if (!Number.isInteger(state.offset)) {
      throw new SqlBuilderError('OFFSET must be an integer', {
        state: 'invalid_offset',
        offset: state.offset,
      })
    }
  }

  if (state.unions.length > 0) {
    for (const union of state.unions) {
      if (!union.query || !union.query.state) {
        throw new SqlBuilderError(
          'Invalid UNION query: query is null or undefined',
          {
            state: 'invalid_union',
          }
        )
      }
    }
  }
}

function validateCtes(ctes: BuilderState['ctes']): void {
  const names = new Set<string>()

  for (const cte of ctes) {
    if (names.has(cte.name)) {
      throw new SqlBuilderError(`Duplicate CTE name: ${cte.name}`, {
        state: 'duplicate_cte',
        cteName: cte.name,
      })
    }
    names.add(cte.name)

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cte.name)) {
      throw new SqlBuilderError(
        `Invalid CTE name: ${cte.name}. Must start with letter/underscore and contain only alphanumeric characters and underscores`,
        {
          state: 'invalid_cte_name',
          cteName: cte.name,
        }
      )
    }

    if (!cte.query || !cte.query.state) {
      throw new SqlBuilderError(`CTE ${cte.name} has no query defined`, {
        state: 'invalid_cte_query',
        cteName: cte.name,
      })
    }
  }
}

function validateJoins(joins: SqlJoin[]): void {
  const aliases = new Set<string>()

  for (const join of joins) {
    if (join.alias) {
      if (aliases.has(join.alias)) {
        throw new SqlBuilderError(`Duplicate JOIN alias: ${join.alias}`, {
          state: 'duplicate_join_alias',
          alias: join.alias,
        })
      }
      aliases.add(join.alias)
    }

    // JOIN must have either condition or USING clause (except CROSS JOIN and ARRAY JOIN)
    if (join.type !== 'CROSS' && join.type !== 'ARRAY') {
      if (!join.condition && (!join.using || join.using.length === 0)) {
        throw new SqlBuilderError(
          `${join.type} JOIN requires either ON condition or USING clause`,
          {
            state: 'missing_join_condition',
            joinType: join.type,
            table: typeof join.table === 'string' ? join.table : 'subquery',
          }
        )
      }

      if (join.condition && join.using && join.using.length > 0) {
        throw new SqlBuilderError(
          `JOIN cannot have both ON and USING clauses`,
          {
            state: 'conflicting_join_clauses',
            joinType: join.type,
          }
        )
      }
    }

    if (typeof join.table === 'string') {
      if (join.table.trim() === '') {
        throw new SqlBuilderError('JOIN table name cannot be empty', {
          state: 'empty_join_table',
        })
      }
    }
  }
}

function validateConditions(
  conditions: (SqlCondition | WhereGroup)[],
  clauseName: 'WHERE' | 'HAVING'
): void {
  for (const condition of conditions) {
    if ('conditions' in condition) {
      if (condition.conditions.length === 0) {
        throw new SqlBuilderError(
          `${clauseName} group cannot be empty. Groups must contain at least one condition`,
          {
            state: 'empty_condition_group',
            clauseName,
          }
        )
      }
      validateConditions(condition.conditions, clauseName)
    } else {
      // Skip validation for raw SQL conditions (empty column/operator)
      if (
        condition.value &&
        typeof condition.value === 'object' &&
        'toSql' in condition.value &&
        condition.column === '' &&
        condition.operator === ''
      ) {
        continue
      }

      if (!condition.column || condition.column.trim() === '') {
        throw new SqlBuilderError(
          `${clauseName} condition must have a column name`,
          {
            state: 'missing_condition_column',
            clauseName,
          }
        )
      }

      if (!condition.operator || condition.operator.trim() === '') {
        throw new SqlBuilderError(
          `${clauseName} condition must have an operator`,
          {
            state: 'missing_condition_operator',
            clauseName,
            column: condition.column,
          }
        )
      }

      const validOperators = [
        '=',
        '!=',
        '<>',
        '>',
        '>=',
        '<',
        '<=',
        'LIKE',
        'NOT LIKE',
        'ILIKE',
        'NOT ILIKE',
        'IN',
        'NOT IN',
        'IS',
        'IS NOT',
        'BETWEEN',
        'NOT BETWEEN',
      ]

      const operator = condition.operator.toUpperCase()
      if (!validOperators.includes(operator)) {
        throw new SqlBuilderError(
          `Invalid ${clauseName} operator: ${condition.operator}. Valid operators: ${validOperators.join(', ')}`,
          {
            state: 'invalid_operator',
            clauseName,
            operator: condition.operator,
            column: condition.column,
          }
        )
      }

      if (
        (operator === 'IS' || operator === 'IS NOT') &&
        condition.value !== null
      ) {
        throw new SqlBuilderError(
          `${operator} operator requires NULL value, got: ${condition.value}`,
          {
            state: 'invalid_operator_value',
            operator: condition.operator,
            value: condition.value,
          }
        )
      }
    }
  }
}
