/**
 * Edge and failure paths of `get_page_data` that `page-data-tools.test.ts`
 * does not reach: host scoping on a user's own connection, the feature gate,
 * optional-vs-required failures on both executors, filter handling for configs
 * without a `filterSchema`, and the output shape of multi-query charts.
 *
 * Every executor is mocked so a test can prove which one ran and with which
 * host / credentials. The real table and chart registries are used.
 */

import type { AgentConnectionBinding } from '../../host-query'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

type Any = any

const calls = {
  table: [] as Array<{ name: string; hostId: number; params: Any; sql: Any }>,
  chart: [] as Array<{ name: string; hostId: number; sql: Any }>,
  multi: [] as Array<{ hostId: number }>,
  connTable: [] as Array<{ name: string; credentials: Any; params: Any }>,
  connChart: [] as Array<{ name: string; credentials: Any; params: Any }>,
}
let tableImpl: () => Any
let chartImpl: () => Any
let multiImpl: (queries: Array<{ key: string }>) => Any
let connTableImpl: () => Any
let connChartImpl: () => Any
let appConfig: Any

mock.module('@/lib/api/query-executor', () => ({
  executeTableConfig: async (config: Any, hostId: number, params: Any) => {
    calls.table.push({ name: config.name, hostId, params, sql: config.sql })
    return { result: tableImpl(), executedSql: '', maxResultRows: 0 }
  },
  executeChartQuery: async (name: string, sql: Any, hostId: number) => {
    calls.chart.push({ name, hostId, sql })
    return chartImpl()
  },
  executeMultiChartQuery: async (queries: Any, hostId: number) => {
    calls.multi.push({ hostId })
    return multiImpl(queries)
  },
}))
mock.module('@/lib/connection-query/execute-connection-table', () => ({
  executeConnectionTableConfig: async (
    config: Any,
    credentials: Any,
    p: Any
  ) => {
    calls.connTable.push({ name: config.name, credentials, params: p })
    return connTableImpl()
  },
}))
mock.module('@/lib/connection-query/execute-connection-chart', () => ({
  executeConnectionChartQuery: async (
    name: string,
    credentials: Any,
    p: Any
  ) => {
    calls.connChart.push({ name, credentials, params: p })
    return connChartImpl()
  },
}))
mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => appConfig,
}))

const { runWithAgentConnection } = await import('../../host-query')
const { createPageDataTools } = await import('../page-data-tools')

const binding: AgentConnectionBinding = {
  hostId: -1001,
  userId: 'u1',
  connectionId: 'c1',
  credentials: { host: 'https://ch.example', user: 'u', password: 'p' },
}

const exec = (hostId: number, input: unknown) =>
  (createPageDataTools(hostId).get_page_data as Any).execute(
    input
  ) as Promise<Any>
const onConnection = (input: unknown) =>
  runWithAgentConnection(binding, () => exec(binding.hostId, input))

beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0
  tableImpl = () => ({ data: [], error: null })
  chartImpl = () => ({ dataJson: '[]' })
  multiImpl = (queries) => ({
    results: queries.map((q) => ({ key: q.key, dataJson: '[{"v":1}]' })),
  })
  connTableImpl = () => ({ data: [] })
  connChartImpl = () => ({ data: [] })
  appConfig = { features: {} }
})

describe('get_page_data — host scoping', () => {
  test('the tool-level hostId override reaches the executors', async () => {
    await exec(0, { page: 'merges', hostId: 3 })
    expect(calls.table.length).toBeGreaterThan(0)
    expect(calls.table.every((c) => c.hostId === 3)).toBe(true)
    calls.chart.length = 0
    await exec(0, { page: 'merge-count', hostId: 4 })
    expect(calls.chart.map((c) => c.hostId)).toEqual([4])
  })

  test('without an override the factory host is used', async () => {
    await exec(7, { page: 'merges' })
    expect(calls.table[0].hostId).toBe(7)
  })

  test('a bound connection runs tables on its credentials, never the env host', async () => {
    connTableImpl = () => ({ data: [{ a: 1 }, { a: 2 }] })
    const out = await onConnection({ page: 'merges' })
    expect(calls.connTable[0].credentials).toBe(binding.credentials)
    expect(calls.table).toHaveLength(0)
    expect(out.sources[0]).toMatchObject({ kind: 'table', rowCount: 2 })
  })

  test('a bound connection runs charts on its credentials, never the env host', async () => {
    connChartImpl = () => ({ data: [{ t: 1 }] })
    const out = await onConnection({ page: 'merge-count' })
    expect(calls.connChart[0].credentials).toBe(binding.credentials)
    expect(calls.chart).toHaveLength(0)
    expect(out.sources[0]).toMatchObject({ kind: 'chart', rows: [{ t: 1 }] })
  })

  test('a hostId override that is not the bound connection is refused before any query', async () => {
    await expect(
      runWithAgentConnection(binding, () =>
        exec(binding.hostId, { page: 'merges', hostId: 0 })
      )
    ).rejects.toThrow('not available here')
    expect(calls.table.length + calls.connTable.length).toBe(0)
    expect(calls.chart.length + calls.connChart.length).toBe(0)
  })

  test('multi-query charts on a connection return one keyed entry per query, capped by limit', async () => {
    // `summary-used-by-merges` is a multi-query chart; answer only its first key.
    let firstKey = ''
    multiImpl = (queries) => {
      firstKey = queries[0].key
      return { results: [] }
    }
    await exec(0, { page: 'summary-used-by-merges' })
    connChartImpl = () => ({
      data: { [firstKey]: Array.from({ length: 10 }, (_, i) => ({ i })) },
    })
    const out = await onConnection({ page: 'summary-used-by-merges', limit: 2 })
    const keyed = out.sources[0].rows as Array<{ key: string; rows: Any[] }>
    expect(keyed.length).toBeGreaterThan(1)
    expect(keyed.find((k) => k.key === firstKey)?.rows).toHaveLength(2)
    // A query key the connection returned nothing for is an empty list, not a crash.
    expect(
      keyed.filter((k) => k.key !== firstKey).every((k) => k.rows.length === 0)
    ).toBe(true)
  })
})

describe('get_page_data — failures', () => {
  test('a throwing connection table is an error on a required config and a note on an optional one', async () => {
    connTableImpl = () => {
      throw new Error('conn refused')
    }
    const required = await onConnection({ page: 'merges' })
    expect(required.sources[0].error).toBe('conn refused')

    const optional = await onConnection({ page: 'backups' })
    expect(optional.sources[0].error).toBeUndefined()
    expect(optional.sources[0].note).toBe(
      'Not available on this host: conn refused'
    )
  })

  test('a throwing env table executor is an error with an empty row set', async () => {
    tableImpl = () => {
      throw new Error('ch down')
    }
    const out = await exec(0, { page: 'merges' })
    expect(out.sources[0]).toMatchObject({
      error: 'ch down',
      rows: [],
      rowCount: 0,
      truncated: false,
    })
  })

  test('a non-Error throw is stringified', async () => {
    tableImpl = () => {
      throw 'plain string'
    }
    const out = await exec(0, { page: 'merges' })
    expect(out.sources[0].error).toBe('plain string')
  })

  test('a chart error is surfaced with its message and no rows', async () => {
    chartImpl = () => ({ dataJson: null, error: { message: 'bad sql' } })
    const out = await exec(0, { page: 'merge-count' })
    const s = out.sources[0]
    expect(s.rows).toEqual([])
    expect(`${s.error ?? ''}${s.note ?? ''}`).toContain('bad sql')
  })

  test('a throwing chart executor never rejects the call', async () => {
    chartImpl = () => {
      throw new Error('chart boom')
    }
    const out = await exec(0, { page: 'merge-count' })
    const s = out.sources[0]
    expect(s.rows).toEqual([])
    expect(`${s.error ?? ''}${s.note ?? ''}`).toContain('chart boom')
  })

  test('a throwing multi-query chart executor is a hard error, not an "unavailable" note', async () => {
    multiImpl = () => {
      throw new Error('multi boom')
    }
    const out = await exec(0, { page: 'summary-used-by-merges' })
    expect(out.sources[0].error).toBe('multi boom')
    expect(out.sources[0].note).toBeUndefined()
  })

  test('a throwing required single chart is an error; an optional one is a note', async () => {
    chartImpl = () => {
      throw new Error('boom')
    }
    const required = await exec(0, { page: 'disk-size' })
    expect(required.sources[0].error).toBe('boom')
    const optional = await exec(0, { page: 'merge-count' })
    expect(optional.sources[0].error).toBeUndefined()
    expect(optional.sources[0].note).toBe('Not available on this host: boom')
  })

  test('a failing query inside a multi-query chart is reported on its own entry', async () => {
    multiImpl = (queries) => ({
      results: queries.map((q, i) => ({
        key: q.key,
        dataJson: i === 0 ? null : '[{"v":1}]',
        ...(i === 0 ? { error: { message: 'q0 failed' } } : {}),
      })),
    })
    const out = await exec(0, { page: 'summary-used-by-merges' })
    const keyed = out.sources[0].rows as Any[]
    expect(keyed[0].error).toBe('q0 failed')
    expect(keyed[0].rows).toEqual([])
    expect(keyed[1].error).toBeUndefined()
    expect(keyed[1].rows).toEqual([{ v: 1 }])
  })

  test('a chart whose feature is disabled is skipped with a note and never queried', async () => {
    appConfig = { features: { metrics: { enabled: false } } }
    const out = await exec(0, { page: 'disk-size' })
    expect(out.sources[0].note).toBe(
      'The "metrics" feature is disabled on this deployment.'
    )
    expect(calls.chart).toHaveLength(0)
    expect(calls.connChart).toHaveLength(0)
  })

  test('chart rows tolerate null, invalid JSON, and a single object', async () => {
    chartImpl = () => ({ dataJson: null })
    expect((await exec(0, { page: 'merge-count' })).sources[0].rows).toEqual([])
    chartImpl = () => ({ dataJson: '{not json' })
    expect((await exec(0, { page: 'merge-count' })).sources[0].rows).toEqual([])
    chartImpl = () => ({ dataJson: '{"v":1}' })
    expect((await exec(0, { page: 'merge-count' })).sources[0].rows).toEqual([
      { v: 1 },
    ])
  })
})

describe('get_page_data — filters on configs without a filterSchema', () => {
  test('only declared defaultParams are forwarded; the rest are reported ignored', async () => {
    const out = await exec(0, {
      page: 'failed-queries',
      filters: { last_hours: '24', bogus: 'x' },
    })
    expect(calls.table[0].params).toMatchObject({ last_hours: '24' })
    expect(JSON.stringify(calls.table[0].params)).not.toContain('bogus')
    expect(out.sources[0].ignoredFilters).toEqual(['bogus'])
  })

  test('lastHours fills last_hours when the config declares it, but an explicit filter wins', async () => {
    await exec(0, { page: 'failed-queries', lastHours: 6 })
    expect(calls.table[0].params).toMatchObject({ last_hours: '6' })
    await exec(0, {
      page: 'failed-queries',
      lastHours: 6,
      filters: { last_hours: '48' },
    })
    expect(calls.table[1].params).toMatchObject({ last_hours: '48' })
  })

  test('an explicit operator prefix is kept, a plain value becomes eq:', async () => {
    await exec(0, { page: 'history-queries', filters: { user: 'ne:alice' } })
    await exec(0, { page: 'history-queries', filters: { user: 'alice' } })
    const [ne, eq] = calls.table.map((c) => JSON.stringify(c.sql))
    expect(ne).not.toBe(eq)
    expect(ne).toContain('!=')
    expect(eq).not.toContain('!=')
  })

  test('filters are passed to chart builders', async () => {
    await exec(0, { page: 'disk-size', filters: { name: 'default' } })
    expect(JSON.stringify(calls.chart[0].sql)).toContain("name = 'default'")
  })
})

describe('get_page_data — bounds', () => {
  test('limit below the minimum is clamped up to one row, not rejected', async () => {
    tableImpl = () => ({
      data: Array.from({ length: 5 }, (_, i) => ({ i })),
      error: null,
    })
    const out = await exec(0, { page: 'merges', limit: 0, lastHours: 0 })
    expect(out.sources[0].rows).toHaveLength(1)
    expect(out.sources[0].truncated).toBe(true)
  })

  test('null input and a blank page return the page list', async () => {
    expect((await exec(0, null)).type).toBe('page_list')
    expect((await exec(0, { page: '   ' })).type).toBe('page_list')
  })
})
