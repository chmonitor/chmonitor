/**
 * Heavy queries page only when the whole server is critical. The sweep must
 * (1) hand a signal-only rule to the dispatcher flagged so it is never
 * delivered, (2) carry each base rule's affected names into compound inputs
 * so the page names the offending queries, and (3) evaluate a
 * `partialInputs` compound when one dependency did not run.
 */

import type { DispatchFindingParams } from './dispatch'

import {
  BUILTIN_COMPOUND_RULES,
  BUILTIN_RULES,
} from '../../alerting/builtin-rules'
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// Values per rule id; a missing id has no value, so its rule does not count.
let values: Record<string, { value: string; affected?: string[] }> = {}

const real1 = { ...(await import('@chm/clickhouse-client')) }
const real2 = { ...(await import('@/lib/insights/generate-insights')) }
const real3 = { ...(await import('@/lib/insights/generate-postgres-insights')) }
const real4 = { ...(await import('@/lib/insights/generate-peerdb-insights')) }

mock.module('@chm/clickhouse-client', () => ({
  ...real1,
  fetchData: async ({ query }: { query: string }) => {
    if (query.includes("'table' AS kind")) {
      const data = [
        'system.asynchronous_metrics',
        'system.server_settings',
      ].map((name) => ({ kind: 'table', name }))
      return { data, metadata: {}, error: undefined }
    }
    if (query.includes('AS rule_id')) {
      const data = Object.entries(values)
        .filter(([id]) => query.includes(`'${id}' AS rule_id`))
        .map(([rule_id, v]) => ({
          rule_id,
          value: v.value,
          affected: v.affected ?? [],
        }))
      return { data, metadata: {}, error: undefined }
    }
    return { data: [], metadata: {}, error: undefined }
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

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('@chm/clickhouse-client', () => ({ ...real1 }))
  mock.module('@/lib/insights/generate-insights', () => ({ ...real2 }))
  mock.module('@/lib/insights/generate-postgres-insights', () => ({ ...real3 }))
  mock.module('@/lib/insights/generate-peerdb-insights', () => ({ ...real4 }))
})

const { runHostSweep } = await import('./run-host')
const { resetHostCapabilities } = await import('../capability-cache')

const config = { id: 0, host: 'test-host', user: 'default', password: '' }
const ids = [
  'long-running-queries',
  'heavy-query-memory',
  'memory-pressure',
  'concurrent-queries',
]
const ctx = {
  alertingEnabled: true,
  rules: BUILTIN_RULES.filter((r) => ids.includes(r.id)),
  thresholdOverrides: {},
  orderedCompoundRules: BUILTIN_COMPOUND_RULES.filter(
    (r) => r.id === 'runaway-query-impact'
  ),
} as unknown as Parameters<typeof runHostSweep>[1]

async function run(notifyRules: string[] = []) {
  const dispatched: DispatchFindingParams[] = []
  await runHostSweep(config as never, { ...ctx, notifyRules }, async (p) => {
    dispatched.push(p)
  })
  return Object.fromEntries(dispatched.map((d) => [d.ruleId, d]))
}

beforeEach(() => {
  resetHostCapabilities()
  values = {}
})

describe('runaway query paging through the sweep', () => {
  test('the query signals are dispatched signal-only; the server rules are not', async () => {
    values = {
      'long-running-queries': { value: '7200', affected: ['bob:q1'] },
      'heavy-query-memory': { value: '60', affected: ['bob:q1'] },
      'memory-pressure': { value: '50' },
      'concurrent-queries': { value: '10' },
    }
    const d = await run()
    expect(d['long-running-queries']?.signalOnly).toBe(true)
    expect(d['heavy-query-memory']?.signalOnly).toBe(true)
    expect(d['memory-pressure']?.signalOnly).toBeUndefined()
    // Critical-sized queries on a healthy server: no page.
    expect(d['runaway-query-impact']?.severity).toBe('ok')
  })

  test('HEALTH_ALERT_NOTIFY_RULES opts a signal-only rule into delivery', async () => {
    values = {
      'long-running-queries': { value: '7200', affected: ['bob:q1'] },
      'heavy-query-memory': { value: '60', affected: ['bob:q1'] },
      'memory-pressure': { value: '50' },
      'concurrent-queries': { value: '10' },
    }
    const d = await run(['LONG-running-*'])
    expect(d['long-running-queries']?.signalOnly).toBeUndefined()
    expect(d['heavy-query-memory']?.signalOnly).toBe(true)
  })

  test('a critical server with a heavy query pages, naming the queries', async () => {
    values = {
      'long-running-queries': { value: '900', affected: ['bob:q1', 'amy:q2'] },
      'heavy-query-memory': { value: '35', affected: ['amy:q2', 'eve:q3'] },
      'memory-pressure': { value: '95' },
      'concurrent-queries': { value: '10' },
    }
    const page = (await run())['runaway-query-impact']
    expect(page?.severity).toBe('critical')
    expect(page?.signalOnly).toBeUndefined()
    expect(page?.label).toBe(
      '95% server memory, 10% query slots: bob:q1, amy:q2, eve:q3'
    )
  })

  test('still evaluates when concurrent-queries has no value (unlimited slots)', async () => {
    values = {
      'long-running-queries': { value: '900', affected: ['bob:q1'] },
      'heavy-query-memory': { value: '1' },
      'memory-pressure': { value: '95' },
      // NULL = unlimited max_concurrent_queries: the rule has no result.
      'concurrent-queries': { value: '' },
    }
    const page = (await run())['runaway-query-impact']
    expect(page?.severity).toBe('critical')
  })

  test('the long-running label does not read seconds as a count of queries', async () => {
    values = {
      'long-running-queries': { value: '900', affected: ['bob:q1'] },
      'heavy-query-memory': { value: '1' },
      'memory-pressure': { value: '10' },
      'concurrent-queries': { value: '10' },
    }
    expect((await run())['long-running-queries']?.label).toBe(
      'longest query running 900s: bob:q1'
    )
  })
})
