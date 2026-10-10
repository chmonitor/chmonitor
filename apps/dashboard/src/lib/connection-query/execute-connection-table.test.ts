/**
 * #3684: a table config's `clickhouseSettings` (e.g. the TTL inventory's 25s
 * cap) must reach a browser-stored connection too, not only env hosts.
 */

import { describe, expect, mock, test } from 'bun:test'

const sent: Array<Record<string, unknown> | undefined> = []

mock.module('./connection-client', () => ({
  getConnectionVersion: async () => '24.8',
  queryConnection: async (
    _credentials: unknown,
    _sql: string,
    options?: { clickhouse_settings?: Record<string, unknown> }
  ) => {
    sent.push(options?.clickhouse_settings)
    return { data: [], queryId: 'q' }
  },
}))

const { executeConnectionTableConfig } = await import(
  './execute-connection-table'
)
const { ttlPartitionHealthConfig } = await import(
  '@/lib/query-config/system/ttl-partition-health'
)

describe('executeConnectionTableConfig settings', () => {
  test('forwards the config max_execution_time with the timezone', async () => {
    sent.length = 0
    await executeConnectionTableConfig(
      ttlPartitionHealthConfig,
      {} as Parameters<typeof executeConnectionTableConfig>[1],
      undefined,
      'UTC'
    )
    expect(sent[0]).toEqual({ max_execution_time: 25, session_timezone: 'UTC' })
  })
})
