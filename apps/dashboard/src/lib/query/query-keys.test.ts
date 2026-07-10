import { hostConnectionKey } from './host-query-key'
import { chartQueryKey, tableQueryKey } from './query-keys'
import { describe, expect, test } from 'bun:test'

describe('chartQueryKey', () => {
  test('prefetch and useChartData build identical keys for a default env-host route', () => {
    const hostId = 0
    // What `prefetch.ts` passes for a hover prefetch.
    const prefetchKey = chartQueryKey({
      chartName: 'overview-cpu',
      hostId,
      params: null,
      connectionKey: hostConnectionKey(hostId, null),
    })

    // What `useChartData` passes for the same route with no explicit
    // interval/lastHours/params/timezone (the overview default). For an env
    // host (id >= 0) the hook's `browserConnection` is always `null` too, so
    // this is the true parity comparison, not an approximation.
    const hookKey = chartQueryKey({
      chartName: 'overview-cpu',
      hostId,
      interval: undefined,
      lastHours: undefined,
      params: undefined,
      timezone: undefined,
      connectionKey: hostConnectionKey(hostId, null),
    })

    expect(prefetchKey).toEqual(hookKey)
    expect(prefetchKey).toEqual([
      '/api/v1/charts',
      'overview-cpu',
      0,
      undefined,
      undefined,
      'null',
      undefined,
      undefined,
    ])
  })

  test('pins field ordering with explicit interval/lastHours/params/timezone/connection', () => {
    const key = chartQueryKey({
      chartName: 'query-count',
      hostId: 2,
      interval: '1 HOUR',
      lastHours: 24,
      params: { database: 'default' },
      timezone: 'UTC',
      connectionKey: 'conn-a',
    })

    expect(key).toEqual([
      '/api/v1/charts',
      'query-count',
      2,
      '1 HOUR',
      24,
      JSON.stringify({ database: 'default' }),
      'UTC',
      'conn-a',
    ])
  })
})

describe('tableQueryKey', () => {
  test('prefetch and useTableData build identical keys for a default env-host route', () => {
    const hostId = 0
    // What `prefetch.ts` passes for a hover prefetch.
    const prefetchKey = tableQueryKey({
      queryConfigName: 'tables',
      hostId,
      searchParams: {},
      connectionKey: hostConnectionKey(hostId, null),
    })

    // What `useTableData` passes for the same route with no explicit
    // searchParams/timezone.
    const hookKey = tableQueryKey({
      queryConfigName: 'tables',
      hostId,
      searchParams: undefined,
      timezone: undefined,
      connectionKey: hostConnectionKey(hostId, null),
    })

    expect(prefetchKey).toEqual(hookKey)
    expect(prefetchKey).toEqual([
      '/api/v1/tables',
      'tables',
      0,
      '{}',
      undefined,
      undefined,
    ])
  })

  test('pins field ordering with explicit searchParams/timezone/connection', () => {
    const key = tableQueryKey({
      queryConfigName: 'tables',
      hostId: 3,
      searchParams: { search: 'foo', page: 2 },
      timezone: 'Asia/Ho_Chi_Minh',
      connectionKey: 'conn-b',
    })

    expect(key).toEqual([
      '/api/v1/tables',
      'tables',
      3,
      JSON.stringify({ search: 'foo', page: 2 }),
      'Asia/Ho_Chi_Minh',
      'conn-b',
    ])
  })
})
