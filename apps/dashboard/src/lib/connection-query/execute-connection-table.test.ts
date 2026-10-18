/**
 * #3684: a table config's `clickhouseSettings` (e.g. the TTL inventory's 25s
 * cap) must reach a browser-stored connection too, not only env hosts.
 */

import { describe, expect, mock, test } from 'bun:test'

const sent: Array<Record<string, unknown> | undefined> = []
let serverVersion = '24.8'

mock.module('./connection-client', () => ({
  getConnectionVersion: async () => serverVersion,
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
const { tablesOverviewConfig } = await import(
  '@/lib/query-config/tables/tables-overview'
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

  // 26.9 rejects `allow_experimental_analyzer = 0` (analyzer mandatory), so a
  // per-user connection to 26.9 must not send it; older servers still get it.
  test('drops analyzer-off on 26.9 and keeps it on 26.8', async () => {
    const credentials = {} as Parameters<typeof executeConnectionTableConfig>[1]
    sent.length = 0
    serverVersion = '26.9.21.9'
    await executeConnectionTableConfig(tablesOverviewConfig, credentials)
    serverVersion = '26.8.30.8'
    await executeConnectionTableConfig(tablesOverviewConfig, credentials)
    serverVersion = '24.8'
    expect(sent[0]).toEqual({})
    expect(sent[1]).toEqual({ allow_experimental_analyzer: 0 })
  })
})
