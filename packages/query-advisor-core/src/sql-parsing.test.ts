// Moved here from apps/dashboard (`__tests__/recommendation-engine.test.ts`)
// and packages/mcp-server (`__tests__/advisor-sql-parse.test.ts`) when the two
// forks were merged into this package — issue #2936.
import { describe, expect, test } from 'bun:test'

import {
  extractClauseColumns,
  extractPredicates,
  extractReferencedTables,
  findWhereSpan,
  formatQualifiedTable,
  parseExplainIndexes,
  quoteIdentifier,
  splitTopLevelAnd,
} from './sql-parsing'
import {
  EXPLAIN_INDEXES_LOW_PRUNING,
  EXPLAIN_INDEXES_WITH_SKIP,
} from './test-fixtures'

describe('extractPredicates', () => {
  test('captures equality, range, and IN predicates joined by AND', () => {
    const sql =
      "SELECT * FROM t WHERE status = 'error' AND created_at > '2026-01-01' AND user_id IN (1, 2, 3)"
    const predicates = extractPredicates(sql)
    expect(predicates).toEqual([
      { column: 'status', operator: '=', isRange: false, isEqualityOrIn: true },
      {
        column: 'created_at',
        operator: '>',
        isRange: true,
        isEqualityOrIn: false,
      },
      {
        column: 'user_id',
        operator: 'IN',
        isRange: false,
        isEqualityOrIn: true,
      },
    ])
  })

  test('ignores queries with no WHERE clause', () => {
    expect(extractPredicates('SELECT * FROM t')).toEqual([])
    expect(extractPredicates('SELECT * FROM default.events')).toEqual([])
  })

  test('strips backtick-quoted column names', () => {
    const predicates = extractPredicates('SELECT * FROM t WHERE `user id` = 1')
    expect(predicates[0]?.column).toBe('user id')
  })

  test('quoted identifier containing a keyword is parsed correctly', () => {
    const predicates = extractPredicates('SELECT * FROM t WHERE `where` = 1')
    expect(predicates).toEqual([
      { column: 'where', operator: '=', isRange: false, isEqualityOrIn: true },
    ])
  })

  test('nested parentheses in WHERE still extracts the top-level predicate', () => {
    const sql =
      'SELECT * FROM default.events WHERE status = 1 AND (level = 2 OR level = 3)'
    expect(extractPredicates(sql).some((p) => p.column === 'status')).toBe(true)
  })

  test('BETWEEN is classified as a range predicate', () => {
    const sql =
      "SELECT * FROM t WHERE event_date BETWEEN '2024-01-01' AND '2024-01-31'"
    expect(extractPredicates(sql)[0]).toMatchObject({
      column: 'event_date',
      operator: 'BETWEEN',
      isRange: true,
      isEqualityOrIn: false,
    })
  })
})

describe('extractClauseColumns', () => {
  test('extracts a simple GROUP BY column list', () => {
    expect(
      extractClauseColumns(
        'SELECT a, b, count() FROM t GROUP BY a, b ORDER BY a',
        'GROUP BY'
      )
    ).toEqual(['a', 'b'])
  })

  test('extracts ORDER BY columns and strips ASC/DESC', () => {
    expect(
      extractClauseColumns(
        'SELECT * FROM t ORDER BY a ASC, b DESC LIMIT 10',
        'ORDER BY'
      )
    ).toEqual(['a', 'b'])
  })

  test('skips function-expression columns conservatively', () => {
    expect(
      extractClauseColumns(
        'SELECT * FROM t GROUP BY toDate(ts), status',
        'GROUP BY'
      )
    ).toEqual(['status'])
  })

  test('returns empty when the clause is absent', () => {
    expect(extractClauseColumns('SELECT * FROM t', 'GROUP BY')).toEqual([])
  })
})

describe('parseExplainIndexes', () => {
  test('parses PrimaryKey parts/granules from realistic EXPLAIN indexes=1 text', () => {
    const result = parseExplainIndexes(EXPLAIN_INDEXES_LOW_PRUNING)
    expect(result.primaryKey).toEqual({
      partsRead: 20,
      partsTotal: 20,
      granulesRead: 9000,
      granulesTotal: 10000,
    })
    expect(result.skipIndexes).toEqual([])
  })

  test('parses an existing Skip index block alongside PrimaryKey', () => {
    const result = parseExplainIndexes(EXPLAIN_INDEXES_WITH_SKIP)
    expect(result.primaryKey?.granulesRead).toBe(9000)
    expect(result.skipIndexes).toEqual([
      {
        name: 'idx_status',
        description: 'minmax GRANULARITY 4',
        partsRead: 5,
        partsTotal: 20,
        granulesRead: 100,
        granulesTotal: 9000,
      },
    ])
  })

  test('degrades gracefully (no throw, null primaryKey) on unrecognized output', () => {
    const result = parseExplainIndexes([
      'Some totally different EXPLAIN shape',
      'from a future ClickHouse version',
    ])
    expect(result.primaryKey).toBeNull()
    expect(result.skipIndexes).toEqual([])
  })

  test('handles an empty explain result', () => {
    expect(parseExplainIndexes([])).toEqual({
      primaryKey: null,
      skipIndexes: [],
    })
  })
})

describe('extractReferencedTables', () => {
  test('JOIN across two databases returns both qualified tables', () => {
    const sql =
      'SELECT * FROM db1.events e JOIN db2.users u ON e.user_id = u.id'
    expect(
      extractReferencedTables(sql).map((t) => t.qualifiedName)
    ).toEqual(['db1.events', 'db2.users'])
  })

  test('unqualified tables fall back to the default database', () => {
    expect(extractReferencedTables('SELECT * FROM events', 'analytics')).toEqual(
      [
        {
          raw: 'events',
          database: 'analytics',
          table: 'events',
          qualifiedName: 'analytics.events',
        },
      ]
    )
  })

  test('CTE aliases are not reported as tables, but their real FROM table is', () => {
    const sql =
      'WITH recent AS (SELECT * FROM analytics.events WHERE event_date > today() - 7) SELECT * FROM recent'
    const tables = extractReferencedTables(sql)
    expect(tables.map((t) => t.qualifiedName)).toEqual(['analytics.events'])
  })
})

describe('identifier quoting', () => {
  test('quoteIdentifier escapes embedded backticks', () => {
    expect(quoteIdentifier('we`ird')).toBe('`we``ird`')
  })

  test('formatQualifiedTable quotes both parts', () => {
    expect(formatQualifiedTable('db', 'events')).toBe('`db`.`events`')
  })
})

describe('splitTopLevelAnd / findWhereSpan', () => {
  test('splits only on top-level AND, keeping parenthesized groups intact', () => {
    expect(
      splitTopLevelAnd("status = 'error' AND (region = 'us' OR region = 'eu')")
    ).toEqual(["status = 'error'", "(region = 'us' OR region = 'eu')"])
  })

  test('returns null when there is no WHERE clause', () => {
    expect(findWhereSpan('SELECT * FROM t')).toBeNull()
  })

  test('extracts the WHERE body up to the next clause keyword', () => {
    const span = findWhereSpan('SELECT * FROM t WHERE a = 1 AND b = 2 ORDER BY a')
    expect(span?.body).toBe('a = 1 AND b = 2')
  })
})
