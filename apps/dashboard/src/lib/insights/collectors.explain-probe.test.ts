import type { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

import { describe, expect, mock, test } from 'bun:test'

type ReadOnlyQueryOptions = Parameters<typeof readOnlyQuery>[0]

const readOnlyQueryMock = mock(
  async (_options: ReadOnlyQueryOptions): Promise<unknown> => []
)
const analyzeQueryMock = mock(
  async (_input: { hostId: number; sql: string }) => ({ ok: false })
)

mock.module('@/lib/ai/agent/tools/helpers', () => ({
  readOnlyQuery: readOnlyQueryMock,
}))
mock.module('../ai/advisor/recommendation-engine', () => ({
  analyzeQuery: analyzeQueryMock,
}))

const { collectSchemaOptimizations } = await import('./collectors')
const { createFailedProbeMemory, QUERY_LOG_CUT_LENGTH } = await import(
  './explain-probe-memory'
)

const isHeavySql = (sql: string) => sql.includes('normalized_query_hash')
const explainCalls = () =>
  readOnlyQueryMock.mock.calls
    .map((c) => c[0].query)
    .filter((q) => q.startsWith('EXPLAIN'))

function setup(
  samples: Array<{ sample_query: string; query_hash: string }>,
  explainFails: (sql: string) => boolean,
  failure = 'Syntax error: failed at position 514'
) {
  readOnlyQueryMock.mockReset()
  analyzeQueryMock.mockReset()
  analyzeQueryMock.mockImplementation(async () => ({ ok: false }))
  readOnlyQueryMock.mockImplementation(async ({ query }) => {
    if (isHeavySql(query)) return samples
    if (explainFails(query)) {
      throw new Error(failure)
    }
    return []
  })
}

describe('collectSchemaOptimizations EXPLAIN probing', () => {
  test('a failed hash is not re-probed within the window, but is after expiry', async () => {
    let t = 0
    const memory = createFailedProbeMemory({ ttlMs: 1000, now: () => t })
    setup([{ sample_query: 'SELECT broken', query_hash: '42' }], () => true)

    await collectSchemaOptimizations(0, memory)
    expect(explainCalls()).toHaveLength(1)

    t = 999
    await collectSchemaOptimizations(0, memory)
    expect(explainCalls()).toHaveLength(1)

    t = 1000
    await collectSchemaOptimizations(0, memory)
    expect(explainCalls()).toHaveLength(2)
    expect(analyzeQueryMock).not.toHaveBeenCalled()
  })

  test('a query that explains fine is analyzed every sweep and never remembered', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup([{ sample_query: 'SELECT 1 FROM t', query_hash: '7' }], () => false)

    await collectSchemaOptimizations(0, memory)
    await collectSchemaOptimizations(0, memory)

    expect(analyzeQueryMock).toHaveBeenCalledTimes(2)
    expect(memory.has('0:7')).toBe(false)
  })

  test('one failing hash does not stop the others from being analyzed', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [
        { sample_query: 'SELECT bad', query_hash: '1' },
        { sample_query: 'SELECT good', query_hash: '2' },
      ],
      (q) => q.includes('SELECT bad')
    )

    await collectSchemaOptimizations(0, memory)

    expect(analyzeQueryMock).toHaveBeenCalledTimes(1)
    expect(analyzeQueryMock.mock.calls[0][0].sql).toBe('SELECT good')
  })

  test('strips trailing FORMAT and semicolon before EXPLAIN and analysis', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [
        {
          sample_query: 'SELECT 1 FROM t FORMAT JSONEachRow;',
          query_hash: '9',
        },
      ],
      () => false
    )

    await collectSchemaOptimizations(0, memory)

    expect(explainCalls()).toEqual(['EXPLAIN PLAN indexes = 1 SELECT 1 FROM t'])
    expect(analyzeQueryMock.mock.calls[0][0].sql).toBe('SELECT 1 FROM t')
  })

  test('a truncated sample is skipped: no EXPLAIN, no analysis', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [
        {
          sample_query: `SELECT ${'x'.repeat(QUERY_LOG_CUT_LENGTH)}`,
          query_hash: '5',
        },
      ],
      () => false
    )

    expect(await collectSchemaOptimizations(0, memory)).toEqual([])
    expect(explainCalls()).toHaveLength(0)
    expect(analyzeQueryMock).not.toHaveBeenCalled()
  })

  test('the sampled SQL is only ever sent inside an EXPLAIN (read-only probe)', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup([{ sample_query: 'SELECT 1 FROM t', query_hash: '3' }], () => false)

    await collectSchemaOptimizations(0, memory)

    const sent = readOnlyQueryMock.mock.calls.map((c) => c[0].query)
    expect(
      sent.filter(
        (q) => q.includes('SELECT 1 FROM t') && !q.startsWith('EXPLAIN')
      )
    ).toEqual([])
  })

  test.each([
    "SELECT * FROM url('http://x/y', CSV, 'a String')",
    "SELECT * FROM s3('https://b/k', 'CSV')",
    "SELECT * FROM remote('host', db.t)",
  ])('a sample the validator rejects never reaches the cluster: %s', async (sample) => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup([{ sample_query: sample, query_hash: '11' }], () => false)

    await collectSchemaOptimizations(0, memory)

    expect(explainCalls()).toHaveLength(0)
    expect(analyzeQueryMock).not.toHaveBeenCalled()
    expect(memory.size).toBe(0)
  })

  test.each([
    'Code: 62. DB::Exception: Syntax error (SYNTAX_ERROR)',
    'Code: 47. DB::Exception: Unknown identifier x (UNKNOWN_IDENTIFIER)',
  ])('a deterministic failure is remembered: %s', async (failure) => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [{ sample_query: 'SELECT a FROM t', query_hash: '21' }],
      () => true,
      failure
    )
    await collectSchemaOptimizations(0, memory)
    expect(memory.has('0:21')).toBe(true)
  })

  test.each([
    'Code: 164. DB::Exception: Cannot modify settings in readonly mode (READONLY)',
    'Timeout error: socket timeout',
    'fetch failed: ECONNREFUSED',
  ])('a transient failure is retried next sweep: %s', async (failure) => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [{ sample_query: 'SELECT a FROM t', query_hash: '22' }],
      () => true,
      failure
    )
    await collectSchemaOptimizations(0, memory)
    await collectSchemaOptimizations(0, memory)
    expect(memory.size).toBe(0)
    expect(explainCalls()).toHaveLength(2)
  })

  test('without a string query_hash the failure is not remembered', async () => {
    const memory = createFailedProbeMemory({ now: () => 0 })
    setup(
      [
        {
          sample_query: 'SELECT a FROM t',
          query_hash: undefined as unknown as string,
        },
      ],
      () => true
    )
    await collectSchemaOptimizations(0, memory)
    expect(memory.size).toBe(0)
  })
})
