// @ts-nocheck — test file, only runs under bun:test

import {
  extractClauseColumns,
  extractPredicates,
  parseExplainIndexes,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from '../recommendation-engine'
import {
  EXPLAIN_INDEXES_LOW_PRUNING,
  EXPLAIN_INDEXES_WITH_SKIP,
  makeContext,
  makeParts,
  makeSchema,
  makeSkipIndex,
} from './fixtures'
import { describe, expect, test } from 'bun:test'

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
  })

  test('strips backtick-quoted column names', () => {
    const predicates = extractPredicates('SELECT * FROM t WHERE `user id` = 1')
    expect(predicates[0]?.column).toBe('user id')
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

describe('scoreSkipIndex', () => {
  test('recommends a set index for an equality predicate on a non-sorting-key column', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const [rec] = scoreSkipIndex(ctx)
    expect(rec.kind).toBe('skip_index')
    expect(rec.ddl).toContain('ADD INDEX')
    expect(rec.ddl).toContain('TYPE set(100)')
    expect(rec.ddl).toContain('`status`')
    expect(rec.risk).toBe('low')
    expect(rec.estImpact.unknown).toBe(false)
    expect(rec.estImpact.granulesSaved).toBeGreaterThan(0)
  })

  test('recommends a minmax index for a range predicate', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'latency_ms',
          operator: '>',
          isRange: true,
          isEqualityOrIn: false,
        },
      ],
    })
    const [rec] = scoreSkipIndex(ctx)
    expect(rec.ddl).toContain('TYPE minmax')
  })

  test('does not recommend a skip index for a column already in the sorting key', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'user_id',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    expect(scoreSkipIndex(ctx)).toEqual([])
  })

  test('does not recommend a skip index that already exists', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
      schema: makeSchema({
        existingSkipIndexes: [makeSkipIndex({ expression: 'status' })],
      }),
    })
    expect(scoreSkipIndex(ctx)).toEqual([])
  })

  test('falls back to an unknown, zero impact when EXPLAIN data is unavailable (never fabricates a number)', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
      explain: null,
      parts: makeParts({ totalGranules: 0 }),
    })
    const [rec] = scoreSkipIndex(ctx)
    expect(rec.estImpact.unknown).toBe(true)
    expect(rec.estImpact.granulesSaved).toBe(0)
    expect(rec.estImpact.summary).toContain('could not be estimated')
  })
})

describe('scoreProjection', () => {
  test('recommends a projection when GROUP BY does not match the sorting key prefix', () => {
    const ctx = makeContext({
      groupByColumns: ['status'],
      schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
    })
    const rec = scoreProjection(ctx)
    expect(rec).not.toBeNull()
    expect(rec?.kind).toBe('projection')
    expect(rec?.ddl).toContain('ADD PROJECTION')
    expect(rec?.risk).toBe('medium')
    expect(rec?.effort).toBe('medium')
  })

  test('does not recommend a projection when GROUP BY matches a sorting-key prefix', () => {
    const ctx = makeContext({
      groupByColumns: ['event_date'],
      schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
    })
    expect(scoreProjection(ctx)).toBeNull()
  })

  test('falls back to ORDER BY when there is no GROUP BY', () => {
    const ctx = makeContext({
      groupByColumns: [],
      orderByColumns: ['status'],
      schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
    })
    const rec = scoreProjection(ctx)
    expect(rec?.title).toContain('status')
  })

  test('returns null when the query has neither GROUP BY nor ORDER BY', () => {
    expect(
      scoreProjection(makeContext({ groupByColumns: [], orderByColumns: [] }))
    ).toBeNull()
  })
})

describe('scorePartitionKey', () => {
  test('recommends partitioning on a range-filtered Date column not in the partition key', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'created_at',
          operator: '>',
          isRange: true,
          isEqualityOrIn: false,
        },
      ],
      schema: makeSchema({
        partitionKeyColumns: ['event_date'],
        columns: [
          ...makeSchema().columns,
          {
            name: 'created_at',
            type: 'DateTime',
            isInPartitionKey: false,
            isInSortingKey: false,
            compressedBytes: 1000,
            uncompressedBytes: 2000,
          },
        ],
      }),
    })
    const rec = scorePartitionKey(ctx)
    expect(rec).not.toBeNull()
    expect(rec?.kind).toBe('partition_key')
    expect(rec?.risk).toBe('high')
    expect(rec?.effort).toBe('high')
    expect(rec?.ddl).toContain('CREATE TABLE')
    expect(rec?.ddl).not.toContain('ALTER TABLE') // cannot be ALTERed in place
  })

  test('does not recommend when the range column is already part of the partition key (even wrapped in an expression)', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'event_date',
          operator: '>',
          isRange: true,
          isEqualityOrIn: false,
        },
      ],
      schema: makeSchema({ partitionKeyColumns: ['toYYYYMM', 'event_date'] }),
    })
    expect(scorePartitionKey(ctx)).toBeNull()
  })

  test('does not recommend for a non-Date/DateTime column', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'latency_ms',
          operator: '>',
          isRange: true,
          isEqualityOrIn: false,
        },
      ],
    })
    expect(scorePartitionKey(ctx)).toBeNull()
  })

  test('does not recommend for an equality predicate (range-only heuristic)', () => {
    const ctx = makeContext({
      predicates: [
        {
          column: 'created_at',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
      schema: makeSchema({
        columns: [
          ...makeSchema().columns,
          {
            name: 'created_at',
            type: 'DateTime',
            isInPartitionKey: false,
            isInSortingKey: false,
            compressedBytes: 1000,
            uncompressedBytes: 2000,
          },
        ],
      }),
    })
    expect(scorePartitionKey(ctx)).toBeNull()
  })
})

describe('rankRecommendations', () => {
  test('sorts by granules saved descending', () => {
    const low = makeContext().schema // unused, just to keep imports tidy
    void low
    const recs = [
      {
        kind: 'skip_index',
        title: 'a',
        rationale: '',
        ddl: '',
        risk: 'low',
        riskNote: '',
        effort: 'low',
        estImpact: {
          granulesSaved: 10,
          granulesRead: 100,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      },
      {
        kind: 'projection',
        title: 'b',
        rationale: '',
        ddl: '',
        risk: 'low',
        riskNote: '',
        effort: 'low',
        estImpact: {
          granulesSaved: 500,
          granulesRead: 100,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      },
    ] as const
    const ranked = rankRecommendations([...recs])
    expect(ranked[0]?.title).toBe('b')
    expect(ranked[1]?.title).toBe('a')
  })

  test('breaks ties on equal impact by lower risk, then lower effort', () => {
    const base = {
      rationale: '',
      ddl: '',
      estImpact: {
        granulesSaved: 10,
        granulesRead: 100,
        bytesSaved: 0,
        unknown: false,
        summary: '',
      },
    }
    const recs = [
      {
        ...base,
        kind: 'partition_key',
        title: 'high-risk',
        risk: 'high',
        effort: 'high',
        riskNote: '',
      },
      {
        ...base,
        kind: 'skip_index',
        title: 'low-risk',
        risk: 'low',
        effort: 'low',
        riskNote: '',
      },
      {
        ...base,
        kind: 'projection',
        title: 'medium-risk',
        risk: 'medium',
        effort: 'medium',
        riskNote: '',
      },
    ] as const
    const ranked = rankRecommendations([...recs])
    expect(ranked.map((r) => r.title)).toEqual([
      'low-risk',
      'medium-risk',
      'high-risk',
    ])
  })

  test('never mutates the input array', () => {
    const recs = [
      {
        kind: 'skip_index',
        title: 'a',
        rationale: '',
        ddl: '',
        risk: 'low',
        riskNote: '',
        effort: 'low',
        estImpact: {
          granulesSaved: 1,
          granulesRead: 1,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      },
      {
        kind: 'projection',
        title: 'b',
        rationale: '',
        ddl: '',
        risk: 'low',
        riskNote: '',
        effort: 'low',
        estImpact: {
          granulesSaved: 2,
          granulesRead: 1,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      },
    ] as const
    const original = [...recs]
    rankRecommendations([...recs])
    expect(recs).toEqual(original)
  })
})
