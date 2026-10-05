import type { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

import { describe, expect, mock, test } from 'bun:test'

// Parameter and return types are taken from the real `readOnlyQuery` so this
// stays a faithful double: a zero-arg stub would type `mock.calls` as `[][]`
// and make reading the SQL the collector sent impossible without a cast.
type ReadOnlyQueryOptions = Parameters<typeof readOnlyQuery>[0]

const readOnlyQueryMock = mock(
  async (_options: ReadOnlyQueryOptions): Promise<unknown> => []
)

mock.module('@/lib/ai/agent/tools/helpers', () => ({
  readOnlyQuery: readOnlyQueryMock,
}))

mock.module('../ai/advisor/recommendation-engine', () => ({
  analyzeQuery: mock(async () => ({ ok: false })),
}))

const { ADVISOR_WEEKLY_REPORT_MAX, collectAdvisorRecommendations } =
  await import('./collectors')
const { selectSchemaOptimizations } = await import('./schema-optimizations')

describe('collectAdvisorRecommendations cap', () => {
  test('ADVISOR_WEEKLY_REPORT_MAX defaults to 5', () => {
    expect(ADVISOR_WEEKLY_REPORT_MAX).toBe(5)
  })
})

describe('heavy-queries collector column name', () => {
  // The query used to alias `any(query) AS query`, whose alias the analyzer
  // substitutes into its own WHERE, so the whole insight failed with
  // ILLEGAL_AGGREGATION (code 184) on ClickHouse 24.3+. The alias is now
  // `sample_query` — the name the advisor's shape-mining SQL already uses — so
  // the collector must read THAT key. If the alias and this read ever drift
  // apart again, the insight silently returns nothing: a rename on one side
  // alone is exactly the failure this pins.
  test('reads sample_query and never the shadowing `query` alias', async () => {
    readOnlyQueryMock.mockReset()
    readOnlyQueryMock.mockImplementation(async () => [
      { sample_query: 'SELECT 1 FROM t' },
    ])

    await collectAdvisorRecommendations(0)

    const heavyQueriesSql = readOnlyQueryMock.mock.calls
      .map((call) => call[0].query)
      .find((sql) => sql.includes('normalized_query_hash'))

    expect(heavyQueriesSql).toBeDefined()
    expect(heavyQueriesSql).toContain('any(query) AS sample_query')
    expect(heavyQueriesSql).not.toMatch(/\bany\(query\)\s+AS\s+query\b/)
  })

  test('a row carrying only the old `query` key yields no insight', async () => {
    readOnlyQueryMock.mockReset()
    readOnlyQueryMock.mockImplementation(async () => [
      { query: 'SELECT 1 FROM t' },
    ])

    expect(await collectAdvisorRecommendations(0)).toEqual([])
  })
})

describe('advisor dismissal keys', () => {
  test('advisorInsightKey is namespaced separately from insightKey', async () => {
    const { advisorInsightKey, insightKey } = await import('./types')
    const candidate = {
      category: 'optimization',
      metric: 'schema_opt:skip_index:default.events:foo',
      title: 'Add index on default.events',
    }
    expect(advisorInsightKey(0, candidate)).toBe(
      `advisor:${insightKey(0, candidate)}`
    )
    expect(advisorInsightKey(0, candidate)).not.toBe(insightKey(0, candidate))
  })

  test('selectSchemaOptimizations metric stays impact-independent for advisor rows', () => {
    const rec = {
      kind: 'skip_index' as const,
      title: 'Add a skip index on `user_id`',
      rationale: 'filtered',
      ddl: 'ALTER TABLE ...',
      risk: 'low' as const,
      riskNote: 'additive',
      effort: 'low' as const,
      estImpact: {
        granulesSaved: 5,
        granulesRead: 10,
        bytesSaved: 100,
        summary: 'save',
        unknown: false,
      },
    }
    const [a] = selectSchemaOptimizations([
      {
        database: 'default',
        table: 'events',
        recommendations: [rec],
      },
    ])
    const [b] = selectSchemaOptimizations([
      {
        database: 'default',
        table: 'events',
        recommendations: [
          {
            ...rec,
            estImpact: { ...rec.estImpact, granulesSaved: 9999 },
          },
        ],
      },
    ])
    expect(a.metric).toBe(b.metric)
    expect(a.title).toBe(b.title)
  })
})
