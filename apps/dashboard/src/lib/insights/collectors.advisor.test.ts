import { describe, expect, mock, test } from 'bun:test'

mock.module('@/lib/ai/agent/tools/helpers', () => ({
  readOnlyQuery: mock(async () => []),
}))

mock.module('../ai/advisor/recommendation-engine', () => ({
  analyzeQuery: mock(async () => ({ ok: false })),
}))

const { collectAdvisorRecommendations, ADVISOR_WEEKLY_REPORT_MAX } =
  await import('./collectors')
const { selectSchemaOptimizations } = await import('./schema-optimizations')

describe('collectAdvisorRecommendations cap', () => {
  test('ADVISOR_WEEKLY_REPORT_MAX defaults to 5', () => {
    expect(ADVISOR_WEEKLY_REPORT_MAX).toBe(5)
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
