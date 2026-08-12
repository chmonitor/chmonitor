// Moved here from apps/dashboard (`__tests__/recommendation-engine.test.ts`
// and `__tests__/sql-rewriter.test.ts`) when the dashboard and MCP forks were
// merged into this package — issue #2936.
import { describe, expect, test } from 'bun:test'

import type { Recommendation } from './types'

import {
  buildPrewhereRecommendation,
  proposePrewhereRewrite,
  rankRecommendations,
  scorePartitionKey,
  scoreProjection,
  scoreSkipIndex,
} from './scorers'
import {
  makeContext,
  makeParts,
  makeSchema,
  makeSkipIndex,
} from './test-fixtures'

function makeRecommendation(
  overrides: Partial<Recommendation> & { title: string }
): Recommendation {
  return {
    kind: 'skip_index',
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
    ...overrides,
  }
}

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

describe('proposePrewhereRewrite', () => {
  test('moves a single selective predicate into PREWHERE', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite).not.toBeNull()
    expect(rewrite?.rewrittenSql).toBe(
      "SELECT * FROM default.events PREWHERE status = 'error'"
    )
    expect(rewrite?.movedPredicate.column).toBe('status')
  })

  test('keeps the remaining AND-joined conditions in WHERE', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error' AND user_id = 5",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
        {
          column: 'user_id',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
      schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain('PREWHERE')
    expect(rewrite?.rewrittenSql).toContain('WHERE user_id = 5')
  })

  test('preserves clauses after WHERE (GROUP BY / ORDER BY / LIMIT) verbatim', () => {
    const ctx = makeContext({
      sql: "SELECT status, count() FROM default.events WHERE status = 'error' GROUP BY status ORDER BY count() DESC LIMIT 10",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain(
      'GROUP BY status ORDER BY count() DESC LIMIT 10'
    )
    expect(rewrite?.rewrittenSql).toContain('PREWHERE')
  })

  test('keeps a parenthesized OR group intact as a single condition (does not split inside it)', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error' AND (region = 'us' OR region = 'eu')",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain(
      "WHERE (region = 'us' OR region = 'eu')"
    )
  })

  test('returns null when there is no WHERE clause', () => {
    expect(
      proposePrewhereRewrite(
        makeContext({ sql: 'SELECT * FROM default.events' })
      )
    ).toBeNull()
  })

  test('returns null when there are no recognized predicates', () => {
    expect(
      proposePrewhereRewrite(
        makeContext({
          sql: 'SELECT * FROM default.events WHERE 1 = 1',
          predicates: [],
        })
      )
    ).toBeNull()
  })

  test('never executes anything — it only returns a string, synchronously', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })
    const result = proposePrewhereRewrite(ctx)
    // Not a Promise, no side effects possible from a plain sync function
    // returning a plain object of strings.
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof result?.rewrittenSql).toBe('string')
    for (const value of Object.values(result ?? {})) {
      expect(typeof value === 'function').toBe(false)
    }
  })
})

describe('buildPrewhereRecommendation', () => {
  test('wraps a rewrite as an inert prewhere recommendation (no DDL)', () => {
    const rewrite = {
      rewrittenSql: "SELECT * FROM t PREWHERE status = 'error'",
      movedPredicate: {
        column: 'status',
        operator: '=',
        isRange: false,
        isEqualityOrIn: true,
      },
    }
    const rec = buildPrewhereRecommendation(rewrite, {
      granulesSaved: 0,
      granulesRead: 42,
      bytesSaved: 0,
      unknown: false,
      summary: 'Rewrite validated',
    })
    expect(rec.kind).toBe('prewhere')
    expect(rec.ddl).toBeNull()
    expect(rec.rewrittenSql).toBe(rewrite.rewrittenSql)
    expect(rec.title).toContain('status')
    expect(rec.risk).toBe('low')
  })
})

describe('rankRecommendations', () => {
  test('sorts by granules saved descending', () => {
    const recs = [
      makeRecommendation({ title: 'a' }),
      makeRecommendation({
        title: 'b',
        kind: 'projection',
        estImpact: {
          granulesSaved: 500,
          granulesRead: 100,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      }),
    ]
    const ranked = rankRecommendations(recs)
    expect(ranked[0]?.title).toBe('b')
    expect(ranked[1]?.title).toBe('a')
  })

  test('breaks ties on equal impact by lower risk, then lower effort', () => {
    const recs = [
      makeRecommendation({
        title: 'high-risk',
        kind: 'partition_key',
        risk: 'high',
        effort: 'high',
      }),
      makeRecommendation({ title: 'low-risk' }),
      makeRecommendation({
        title: 'medium-risk',
        kind: 'projection',
        risk: 'medium',
        effort: 'medium',
      }),
    ]
    const ranked = rankRecommendations(recs)
    expect(ranked.map((r) => r.title)).toEqual([
      'low-risk',
      'medium-risk',
      'high-risk',
    ])
  })

  test('never mutates the input array', () => {
    const recs = [
      makeRecommendation({ title: 'a' }),
      makeRecommendation({
        title: 'b',
        estImpact: {
          granulesSaved: 2,
          granulesRead: 1,
          bytesSaved: 0,
          unknown: false,
          summary: '',
        },
      }),
    ]
    const original = [...recs]
    rankRecommendations(recs)
    expect(recs).toEqual(original)
  })
})
