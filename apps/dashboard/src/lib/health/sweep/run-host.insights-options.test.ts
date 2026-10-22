/**
 * The sweep reads INSIGHTS_SWEEP_ENRICH at its one `generateInsights` call
 * site (#4114): off means `enrich: false`, unset keeps the old behaviour.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({ data: [], metadata: {}, error: undefined }),
  getClickHouseConfigs: () => [],
}))
const insightCalls: Array<[number, unknown]> = []
mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: async (hostId: number, opts?: unknown) => {
    insightCalls.push([hostId, opts])
    return []
  },
}))

const { runHostSweep } = await import('./run-host')

const config = { id: 3, host: 'test-host', user: 'default', password: '' }
const ctx = {
  alertingEnabled: false,
  rules: [],
  thresholdOverrides: {},
  orderedCompoundRules: [],
} as unknown as Parameters<typeof runHostSweep>[1]

const saved = process.env.INSIGHTS_SWEEP_ENRICH

beforeEach(() => {
  delete process.env.INSIGHTS_SWEEP_ENRICH
  insightCalls.length = 0
})

afterAll(() => {
  if (saved === undefined) delete process.env.INSIGHTS_SWEEP_ENRICH
  else process.env.INSIGHTS_SWEEP_ENRICH = saved
})

describe('runHostSweep insight options', () => {
  test('unset: enrichment is not disabled', async () => {
    await runHostSweep(config as never, ctx, async () => {})
    expect(insightCalls).toHaveLength(1)
    expect(insightCalls[0][0]).toBe(3)
    expect(insightCalls[0][1]).toEqual({})
  })

  test('INSIGHTS_SWEEP_ENRICH=false passes enrich:false', async () => {
    process.env.INSIGHTS_SWEEP_ENRICH = 'false'
    await runHostSweep(config as never, ctx, async () => {})
    expect(insightCalls).toHaveLength(1)
    expect(insightCalls[0][1]).toEqual({ enrich: false })
  })
})
