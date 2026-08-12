// @ts-nocheck — test file, only runs under bun:test
//
// The pure estimate math (estimateBytesSaved / summarizeImpact) moved to
// @chm/query-advisor-core and is tested there (packages/query-advisor-core/
// src/impact.test.ts). What remains here is the I/O half this app owns: the
// before/after EXPLAIN ESTIMATE comparison.
import { describe, expect, mock, test } from 'bun:test'

// bun test runs with --isolate, so this mock.module is scoped to this file's
// process (see capacity-forecaster.test.ts for the same pattern).
const mockFetchData = mock(
  async (_params: { query: string; hostId?: number }) => ({
    data: [] as any[],
    error: null,
  })
) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const { measurePrewhereImpact } = await import('../impact-estimator')

describe('measurePrewhereImpact', () => {
  test('validates the rewrite when EXPLAIN ESTIMATE marks are unchanged', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: [{ marks: 42 }],
      error: null,
    }))

    const impact = await measurePrewhereImpact({
      hostId: 0,
      originalSql: "SELECT * FROM t WHERE status = 'x'",
      rewrittenSql: "SELECT * FROM t PREWHERE status = 'x'",
      fallbackGranulesRead: 100,
      fallbackGranulesTotal: 100,
      tableBytes: 1000,
      movedColumn: 'status',
    })

    expect(impact.summary).toContain('validated')
    expect(impact.summary).not.toContain('regress')
  })

  test('flags a regression when the rewrite reads MORE granules than before', async () => {
    let call = 0
    mockFetchData.mockImplementation(async () => {
      call += 1
      // First call = "before" (fewer marks), second call = "after" (more marks).
      return { data: [{ marks: call === 1 ? 10 : 50 }], error: null }
    })

    const impact = await measurePrewhereImpact({
      hostId: 0,
      originalSql: "SELECT * FROM t WHERE status = 'x'",
      rewrittenSql: "SELECT * FROM t PREWHERE status = 'x'",
      fallbackGranulesRead: 100,
      fallbackGranulesTotal: 100,
      tableBytes: 1000,
      movedColumn: 'status',
    })

    expect(impact.summary).toContain('do not apply this rewrite')
  })

  test('degrades to a labeled estimate (never throws) when EXPLAIN fails', async () => {
    mockFetchData.mockImplementation(async () => {
      throw new Error('permission denied')
    })

    const impact = await measurePrewhereImpact({
      hostId: 0,
      originalSql: "SELECT * FROM t WHERE status = 'x'",
      rewrittenSql: "SELECT * FROM t PREWHERE status = 'x'",
      fallbackGranulesRead: 100,
      fallbackGranulesTotal: 200,
      tableBytes: 1000,
      movedColumn: 'status',
    })

    expect(impact.summary).toBeTruthy()
    expect(() => impact).not.toThrow()
  })

  test('never issues anything but EXPLAIN statements', async () => {
    const seenQueries: string[] = []
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      seenQueries.push(query)
      return { data: [{ marks: 1 }], error: null }
    })

    await measurePrewhereImpact({
      hostId: 0,
      originalSql: "SELECT * FROM t WHERE status = 'x'",
      rewrittenSql: "SELECT * FROM t PREWHERE status = 'x'",
      fallbackGranulesRead: 1,
      fallbackGranulesTotal: 1,
      tableBytes: 1,
      movedColumn: 'status',
    })

    expect(seenQueries.length).toBeGreaterThan(0)
    for (const q of seenQueries) {
      expect(q.trim().toUpperCase().startsWith('EXPLAIN')).toBe(true)
    }
  })
})
