import {
  extractPredicates,
  extractReferencedTables,
  findWhereSpan,
} from '../tools/advisor/sql-parse'
import { describe, expect, test } from 'bun:test'

describe('extractPredicates', () => {
  test('query with no WHERE returns no predicates', () => {
    expect(extractPredicates('SELECT * FROM default.events')).toEqual([])
  })

  test('nested parentheses in WHERE still extracts the top-level predicate', () => {
    const sql =
      'SELECT * FROM default.events WHERE status = 1 AND (level = 2 OR level = 3)'
    const predicates = extractPredicates(sql)
    expect(predicates.some((p) => p.column === 'status')).toBe(true)
  })

  test('quoted identifier containing a keyword is parsed correctly', () => {
    const sql = 'SELECT * FROM t WHERE `where` = 1'
    const predicates = extractPredicates(sql)
    expect(predicates).toEqual([
      { column: 'where', operator: '=', isRange: false, isEqualityOrIn: true },
    ])
  })

  test('BETWEEN is classified as a range predicate', () => {
    const sql =
      "SELECT * FROM t WHERE event_date BETWEEN '2024-01-01' AND '2024-01-31'"
    const predicates = extractPredicates(sql)
    expect(predicates[0]).toMatchObject({
      column: 'event_date',
      operator: 'BETWEEN',
      isRange: true,
      isEqualityOrIn: false,
    })
  })

  test('IN is classified as an equality-like predicate', () => {
    const sql = "SELECT * FROM t WHERE status IN ('a', 'b')"
    const predicates = extractPredicates(sql)
    expect(predicates[0]).toMatchObject({
      column: 'status',
      operator: 'IN',
      isRange: false,
      isEqualityOrIn: true,
    })
  })
})

describe('extractReferencedTables', () => {
  test('JOIN across two databases returns both qualified tables', () => {
    const sql =
      'SELECT * FROM db1.events e JOIN db2.users u ON e.user_id = u.id'
    const tables = extractReferencedTables(sql)
    expect(tables).toEqual([
      { database: 'db1', table: 'events', qualifiedName: 'db1.events' },
      { database: 'db2', table: 'users', qualifiedName: 'db2.users' },
    ])
  })

  test('CTE: WITH ... AS (SELECT ... FROM real.table) still resolves the real FROM table', () => {
    const sql =
      'WITH recent AS (SELECT * FROM analytics.events WHERE event_date > today() - 7) SELECT * FROM recent'
    const tables = extractReferencedTables(sql)
    expect(tables.some((t) => t.qualifiedName === 'analytics.events')).toBe(
      true
    )
  })
})

describe('findWhereSpan', () => {
  test('returns null when there is no WHERE clause', () => {
    expect(findWhereSpan('SELECT * FROM t')).toBeNull()
  })

  test('extracts the WHERE body up to the next clause keyword', () => {
    const sql = 'SELECT * FROM t WHERE a = 1 AND b = 2 ORDER BY a'
    const span = findWhereSpan(sql)
    expect(span?.body).toBe('a = 1 AND b = 2')
  })
})
