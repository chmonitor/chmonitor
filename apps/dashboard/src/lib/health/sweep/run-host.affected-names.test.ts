/**
 * Count-only rules name what they count (#3869). "7 stuck merges" sends the
 * operator to the dashboard to find out which; the finding and the alert
 * label must carry up to 5 names and "and N more", on the batched path and on
 * the per-rule path alike.
 */

import type { DispatchFindingParams } from './dispatch'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const NAMES = ['db.a p1', 'db.b p2', 'db.c p3', 'db.d p4', 'db.e p5']
const batchQueries: string[] = []

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async ({ query }: { query: string }) => {
    if (query.includes("'table' AS kind")) {
      return { data: [], metadata: {}, error: undefined }
    }
    if (query.includes('AS rule_id')) {
      batchQueries.push(query)
      return {
        data: [{ rule_id: 'batched-rule', value: '7', affected: NAMES }],
        metadata: {},
        error: undefined,
      }
    }
    return {
      data: [{ v: '2', affected: ['db.x <b>', 'db.y'] }],
      metadata: {},
      error: undefined,
    }
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
    sql: "SELECT 7 AS v, ['x'] AS affected",
    valueKey: 'v',
    affectedKey: 'affected',
    defaults: { warning: 1, critical: 50 },
    formatLabel: (v: number | null) => `${v} stuck merges`,
  },
  {
    id: 'own-statement-rule',
    title: 'Own statement',
    type: 'builtin',
    sql: "SELECT 2 AS v, ['x'] AS affected",
    valueKey: 'v',
    affectedKey: 'affected',
    defaults: { warning: 1, critical: 50 },
    clickhouseSettings: { max_execution_time: 5 },
    formatLabel: (v: number | null) => `${v} failed backups`,
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
  batchQueries.length = 0
})

describe('runHostSweep for a count-only rule with affected names', () => {
  test('the finding and the alert label list the names and "and N more"', async () => {
    const dispatched: DispatchFindingParams[] = []
    const result = await runHostSweep(config as never, ctx, async (p) => {
      dispatched.push(p)
    })

    const expected = {
      'batched-rule':
        '7 stuck merges: db.a p1, db.b p2, db.c p3, db.d p4, db.e p5 and 2 more',
      'own-statement-rule': '2 failed backups: db.x <b>, db.y',
    }
    expect(
      Object.fromEntries(result.findings.map((f) => [f.checkId, f.label]))
    ).toEqual(expected)
    expect(
      Object.fromEntries(dispatched.map((d) => [d.ruleId, d.label]))
    ).toEqual(expected)
  })

  test('the batch reads the names column of a rule that has one', async () => {
    await runHostSweep(config as never, ctx, async () => {})
    expect(batchQueries).toHaveLength(1)
    expect(batchQueries[0]).toContain('`affected` AS affected')
  })
})
