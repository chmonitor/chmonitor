/**
 * A rule whose value is NULL is *unknown*, not healthy. Reading it as 0 used
 * to classify it `ok` and dispatch a false "resolved" for a firing alert, so
 * the sweep must neither record a finding nor dispatch anything for it —
 * on the batched path and on the per-rule path.
 */

import type { DispatchFindingParams } from './dispatch'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** Value returned for every rule, on both the batched and per-rule paths. */
let ruleValue: string | null = null

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async ({ query }: { query: string }) => {
    if (query.includes("'table' AS kind")) {
      return { data: [], metadata: {}, error: undefined }
    }
    if (query.includes('AS rule_id')) {
      return {
        data: [{ rule_id: 'batched-rule', value: ruleValue }],
        metadata: {},
        error: undefined,
      }
    }
    return { data: [{ v: ruleValue }], metadata: {}, error: undefined }
  },
  getClickHouseConfigs: () => [],
}))
mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: async () => [],
}))
mock.module('@/lib/insights/generate-postgres-insights', () => ({
  generatePostgresInsights: async () => [],
}))
mock.module('@/lib/insights/generate-peerdb-insights', () => ({
  generatePeerDBInsights: async () => [],
}))

const { runHostSweep } = await import('./run-host')
const { resetHostCapabilities } = await import('../capability-cache')

const config = { id: 0, host: 'test-host', user: 'default', password: '' }

const rules = [
  {
    id: 'batched-rule',
    title: 'Batched',
    type: 'builtin',
    sql: 'SELECT 1 AS v',
    valueKey: 'v',
    defaults: { warning: 1, critical: 5 },
  },
  {
    // Per-rule settings keep it out of the batch, so it runs its own statement.
    id: 'own-statement-rule',
    title: 'Own statement',
    type: 'builtin',
    sql: 'SELECT 1 AS v',
    valueKey: 'v',
    defaults: { warning: 1, critical: 5 },
    clickhouseSettings: { max_execution_time: 5 },
  },
]

const ctx = {
  alertingEnabled: true,
  rules,
  thresholdOverrides: {},
  orderedCompoundRules: [],
} as unknown as Parameters<typeof runHostSweep>[1]

beforeEach(() => {
  resetHostCapabilities()
})

describe('runHostSweep with a NULL rule value', () => {
  test('records no finding and dispatches nothing (no false resolve)', async () => {
    ruleValue = null
    const dispatched: DispatchFindingParams[] = []
    const result = await runHostSweep(config as never, ctx, async (p) => {
      dispatched.push(p)
    })
    expect(result.findings).toEqual([])
    expect(dispatched).toEqual([])
  })

  test('a real 0 still dispatches ok, so a genuine recovery resolves', async () => {
    ruleValue = '0'
    const dispatched: DispatchFindingParams[] = []
    await runHostSweep(config as never, ctx, async (p) => {
      dispatched.push(p)
    })
    expect(dispatched.map((d) => [d.ruleId, d.severity]).sort()).toEqual([
      ['batched-rule', 'ok'],
      ['own-statement-rule', 'ok'],
    ])
  })
})
