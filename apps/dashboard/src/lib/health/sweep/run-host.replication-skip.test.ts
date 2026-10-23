/**
 * #4044: on a host with no Replicated* / Shared*MergeTree table the
 * replication queue cannot exist, so a queue rule is skipped, not evaluated
 * as OK. Fails on the old code, which ran the rule and dispatched `ok`.
 */

import type { DispatchFindingParams } from './dispatch'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

let replicationRows: Array<{ kind: string; name: string }> = []
let probeFails = false
const ruleQueries: string[] = []

const real1 = { ...(await import('@chm/clickhouse-client')) }
const real2 = { ...(await import('@/lib/insights/generate-insights')) }
const real3 = { ...(await import('@/lib/insights/generate-postgres-insights')) }
const real4 = { ...(await import('@/lib/insights/generate-peerdb-insights')) }

mock.module('@chm/clickhouse-client', () => ({
  ...real1,
  fetchData: async ({ query }: { query: string }) => {
    if (query.includes("'table' AS kind")) {
      if (probeFails) {
        return {
          data: null,
          metadata: {},
          error: { type: 'x', message: 'down' },
        }
      }
      return {
        data: [
          { kind: 'table', name: 'system.replication_queue' },
          ...replicationRows,
        ],
        metadata: {},
        error: undefined,
      }
    }
    ruleQueries.push(query)
    return { data: [{ v: 0 }], metadata: {}, error: undefined }
  },
  getClickHouseConfigs: () => [],
}))
mock.module('@/lib/insights/generate-insights', () => ({
  ...real2,
  generateInsights: async () => [],
}))
mock.module('@/lib/insights/generate-postgres-insights', () => ({
  ...real3,
  generatePostgresInsights: async () => [],
}))
mock.module('@/lib/insights/generate-peerdb-insights', () => ({
  ...real4,
  generatePeerDBInsights: async () => [],
}))

afterAll(() => {
  mock.module('@chm/clickhouse-client', () => ({ ...real1 }))
  mock.module('@/lib/insights/generate-insights', () => ({ ...real2 }))
  mock.module('@/lib/insights/generate-postgres-insights', () => ({ ...real3 }))
  mock.module('@/lib/insights/generate-peerdb-insights', () => ({ ...real4 }))
})

const { runHostSweep } = await import('./run-host')
const { resetHostCapabilities } = await import('../capability-cache')
const { BUILTIN_RULES } = await import('@/lib/alerting/builtin-rules')

const config = { id: 0, host: 'test-host', user: 'default', password: '' }

const queueRule = BUILTIN_RULES.find((r) => r.id === 'replication-queue-stuck')!
const otherRule = {
  id: 'other-rule',
  title: 'Other',
  type: 'builtin',
  sql: 'SELECT 0 AS v',
  valueKey: 'v',
  defaults: { warning: 1, critical: 5 },
}

const ctx = {
  alertingEnabled: true,
  rules: [queueRule, otherRule],
  thresholdOverrides: {},
  orderedCompoundRules: [],
} as unknown as Parameters<typeof runHostSweep>[1]

async function sweep() {
  const dispatched: DispatchFindingParams[] = []
  await runHostSweep(config as never, ctx, async (p) => {
    dispatched.push(p)
  })
  return dispatched.map((d) => d.ruleId)
}

beforeEach(() => {
  resetHostCapabilities()
  replicationRows = []
  probeFails = false
  ruleQueries.length = 0
})

describe('replication-queue-stuck on hosts without replication', () => {
  test('is flagged as requiring replication', () => {
    expect(queueRule.requiresReplication).toBe(true)
  })

  test('is skipped, not dispatched as ok, when no replicated table exists', async () => {
    const ids = await sweep()
    expect(ids).toEqual(['other-rule'])
    expect(ruleQueries.some((q) => q.includes('replication_queue'))).toBe(false)
  })

  test('runs when a Replicated or SharedMergeTree table exists', async () => {
    replicationRows = [{ kind: 'replication', name: 'used' }]
    expect((await sweep()).sort()).toEqual([
      'other-rule',
      'replication-queue-stuck',
    ])
  })

  test('runs when the capability probe fails (unknown, fail open)', async () => {
    probeFails = true
    expect((await sweep()).sort()).toEqual([
      'other-rule',
      'replication-queue-stuck',
    ])
  })
})
