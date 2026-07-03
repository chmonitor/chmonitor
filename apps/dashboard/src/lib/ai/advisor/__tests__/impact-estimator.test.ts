// @ts-nocheck — test file, only runs under bun:test
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
mock.module('@/lib/utils', () => ({
  formatBytes: (bytes: number) => `${bytes}B`,
}))

const { estimateBytesSaved, summarizeImpact, measurePrewhereImpact } =
  await import('../impact-estimator')

describe('estimateBytesSaved', () => {
  test('is proportional to the granules-saved fraction of the table', () => {
    expect(estimateBytesSaved(50, 100, 1000)).toBe(500)
  })

  test('returns 0 when granulesTotal is 0 (never divides by zero)', () => {
    expect(estimateBytesSaved(50, 0, 1000)).toBe(0)
  })

  test('returns 0 for non-positive granulesSaved', () => {
    expect(estimateBytesSaved(0, 100, 1000)).toBe(0)
    expect(estimateBytesSaved(-5, 100, 1000)).toBe(0)
  })

  test('clamps the fraction at 1 even if granulesSaved exceeds granulesTotal', () => {
    expect(estimateBytesSaved(150, 100, 1000)).toBe(1000)
  })
})

describe('summarizeImpact', () => {
  test('labels the summary as an estimate and reports a non-zero saved figure', () => {
    const impact = summarizeImpact({
      granulesRead: 900,
      granulesTotal: 1000,
      granulesSaved: 900,
      tableBytes: 10_000,
      unknown: false,
      label: 'a skip index',
    })
    expect(impact.unknown).toBe(false)
    expect(impact.granulesSaved).toBe(900)
    expect(impact.summary).toContain('ESTIMATE')
    expect(impact.summary).toContain('a skip index')
  })

  test('never fabricates a number when unknown — 0 impact, honest message', () => {
    const impact = summarizeImpact({
      granulesRead: 0,
      granulesTotal: 0,
      granulesSaved: 0,
      tableBytes: 0,
      unknown: true,
      label: 'a projection',
    })
    expect(impact.granulesSaved).toBe(0)
    expect(impact.bytesSaved).toBe(0)
    expect(impact.summary).toContain('could not be estimated')
    expect(impact.summary).not.toContain('ESTIMATE:')
  })
})

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
