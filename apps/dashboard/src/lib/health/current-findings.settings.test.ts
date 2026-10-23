/**
 * #3684: the Active Alerts snapshot runs every rule on its own statement. A
 * rule's `clickhouseSettings` must ride along, or the TTL scan silently falls
 * back to the 60s default.
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'

const calls: Array<{
  query: string
  clickhouse_settings?: Record<string, unknown>
}> = []

const realModule = { ...(await import('@chm/clickhouse-client')) }

mock.module('@chm/clickhouse-client', () => ({
  ...realModule,
  fetchData: async (args: {
    query: string
    clickhouse_settings?: Record<string, unknown>
  }) => {
    // The shared capability probe: report system.parts so the optional TTL
    // rule is not skipped.
    if (args.query.includes("'table' AS kind")) {
      return {
        data: [{ kind: 'table', name: 'system.parts' }],
        metadata: {},
        error: undefined,
      }
    }
    calls.push(args)
    return { data: [{ v: '0' }], metadata: {}, error: undefined }
  },
  getClickHouseConfigs: () => [
    { id: 0, host: 'test-host', user: 'default', password: '' },
    { id: 1, host: 'other-host', user: 'default', password: '' },
  ],
}))

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('@chm/clickhouse-client', () => ({ ...realModule }))
})

const { getCurrentFindings } = await import('./current-findings')
const { BUILTIN_RULES } = await import('@/lib/alerting/builtin-rules')

describe('getCurrentFindings settings', () => {
  test('sends the TTL rule with its 15s cap and readonly', async () => {
    calls.length = 0
    await getCurrentFindings({ hostId: 0 })
    const sql = BUILTIN_RULES.find(
      (r) => r.id === 'ttl-partition-health'
    )!.sql!.trim()
    const ttlCalls = calls.filter((c) => c.query.includes(sql))
    expect(ttlCalls).toHaveLength(1)
    expect(ttlCalls[0]?.clickhouse_settings).toEqual({
      max_execution_time: 15,
      readonly: '1',
    })
  })

  test('rules without settings still send readonly only', () => {
    const plain = calls.find((c) => !c.query.includes('mergetree_tables'))
    expect(plain?.clickhouse_settings).toEqual({ readonly: '1' })
  })

  test('hostId restricts the rule queries to that host', async () => {
    calls.length = 0
    await getCurrentFindings({ hostId: 1 })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => (c as { hostId?: number }).hostId === 1)).toBe(
      true
    )
    calls.length = 0
    expect(await getCurrentFindings({ hostId: 99 })).toEqual([])
    expect(calls).toHaveLength(0)
  })
})
