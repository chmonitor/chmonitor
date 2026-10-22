import { describe, expect, test } from 'bun:test'
import './shared-mocks'

const {
  extractReferencedTables,
  extractWhereColumns,
  hasAggregation,
  hasLimit,
  isLikelyExploratorySelect,
  scoreOrderByCandidate,
  validateAgentSql,
} = await import('../sql-analysis')

describe('sql-analysis helpers', () => {
  test('extracts referenced tables from FROM and JOIN clauses', () => {
    const tables = extractReferencedTables(
      'SELECT * FROM analytics.events e JOIN `default`.`users` u ON u.id = e.user_id',
      'default'
    )

    expect(tables.map((table) => table.qualifiedName)).toEqual([
      'analytics.events',
      'default.users',
    ])
  })

  test('extracts filter columns from WHERE and PREWHERE clauses', () => {
    const columns = extractWhereColumns(
      'SELECT count() FROM events PREWHERE tenant_id = 1 WHERE event_date >= today() AND status IN (1, 2)'
    )

    expect(columns.map((column) => column.name)).toContain('tenant_id')
    expect(columns.map((column) => column.name)).toContain('event_date')
    expect(columns.map((column) => column.name)).toContain('status')
  })

  test('normalizes safe SQL and strips trailing semicolons', () => {
    expect(validateAgentSql('SELECT count(*) FROM system.tables;;')).toBe(
      'SELECT count(*) FROM system.tables'
    )
  })

  test('detects exploratory selects without limits or aggregations', () => {
    expect(isLikelyExploratorySelect('SELECT name FROM system.tables')).toBe(
      true
    )
    expect(isLikelyExploratorySelect('SELECT count() FROM system.tables')).toBe(
      false
    )
    expect(
      isLikelyExploratorySelect('SELECT name FROM system.tables LIMIT 10')
    ).toBe(false)
  })
})

describe('scoreOrderByCandidate', () => {
  test.each([
    ['tenant_id', 10],
    ['status', 10],
    ['country', 10],
    ['env', 10],
    ['event_date', 20],
    ['day_of_week', 20],
    ['event_time', 30],
    ['timestamp', 30],
    ['created_at', 30],
    ['user_name', 40],
    ['session_hash', 40],
    ['hostname', 40],
    ['uuid', 90],
    ['query_id', 90],
    ['trace_id', 90],
    ['id', 90],
    ['value', 50],
    ['', 50],
  ])('scores %p as %p', (name, score) => {
    expect(scoreOrderByCandidate(name)).toBe(score)
  })

  test('is case-insensitive', () => {
    expect(scoreOrderByCandidate('Tenant_ID')).toBe(10)
    expect(scoreOrderByCandidate('EVENT_DATE')).toBe(20)
    expect(scoreOrderByCandidate('QUERY_ID')).toBe(90)
  })

  test('earlier tiers win when a name matches several', () => {
    // tenant (10) beats id suffix (90); type (10) beats user (40);
    // date (20) beats created (30); user (40) beats id suffix (90)
    expect(scoreOrderByCandidate('tenant_id')).toBeLessThan(90)
    expect(scoreOrderByCandidate('user_type')).toBe(10)
    expect(scoreOrderByCandidate('created_date')).toBe(20)
    expect(scoreOrderByCandidate('session_id')).toBe(40)
  })

  test('id only counts as a suffix', () => {
    expect(scoreOrderByCandidate('identity_hash')).toBe(50)
  })

  test('low-cardinality prefixes sort before high-cardinality ids', () => {
    const ordered = [
      'query_id',
      'value',
      'user_name',
      'event_time',
      'tenant_id',
    ]
      .map((n) => ({ n, s: scoreOrderByCandidate(n) }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.n)
    expect(ordered).toEqual([
      'tenant_id',
      'event_time',
      'user_name',
      'value',
      'query_id',
    ])
  })
})

describe('hasLimit / hasAggregation', () => {
  test('hasLimit needs LIMIT followed by a number, any case', () => {
    expect(hasLimit('select 1 limit 5')).toBe(true)
    expect(hasLimit('SELECT 1 LIMIT 10 OFFSET 2')).toBe(true)
    expect(hasLimit('SELECT 1')).toBe(false)
    expect(hasLimit('SELECT limit_col FROM t')).toBe(false)
    expect(hasLimit('SELECT 1 LIMIT x')).toBe(false)
  })

  test('hasAggregation detects aggregate calls and GROUP BY', () => {
    expect(hasAggregation('SELECT uniq(user) FROM t')).toBe(true)
    expect(hasAggregation('SELECT quantile(0.5)(x) FROM t')).toBe(true)
    expect(hasAggregation('SELECT a FROM t group   by a')).toBe(true)
    expect(hasAggregation('SELECT a FROM t')).toBe(false)
    expect(hasAggregation('SELECT account FROM t')).toBe(false)
  })

  test('exploratory select rejects non-SELECT, FORMAT and group by', () => {
    expect(isLikelyExploratorySelect('  select a from t')).toBe(true)
    expect(isLikelyExploratorySelect('SHOW TABLES')).toBe(false)
    expect(isLikelyExploratorySelect('SELECT a FROM t FORMAT JSON')).toBe(false)
    expect(isLikelyExploratorySelect('SELECT a FROM t GROUP BY a')).toBe(false)
  })
})

describe('extractWhereColumns edge cases', () => {
  test('empty input yields no columns', () => {
    expect(extractWhereColumns('')).toEqual([])
  })

  test('counts repeats and sorts by count desc then name', () => {
    expect(
      extractWhereColumns(
        'SELECT 1 FROM t WHERE b = 1 AND a = 2 AND b > 3 OR c LIKE 1'
      )
    ).toEqual([
      { name: 'b', count: 2 },
      { name: 'a', count: 1 },
      { name: 'c', count: 1 },
    ])
  })

  test('strips table alias and quotes', () => {
    expect(
      extractWhereColumns('SELECT 1 FROM t e WHERE e.`my_col` = 1 AND "x" <> 2')
        .map((c) => c.name)
        .sort()
    ).toEqual(['my_col', 'x'])
  })
})
