import type { MergeProgressSnapshot } from './merge-progress'
import type { MergeProgressStore } from './merge-progress-store'

import { BUILTIN_RULES } from '../alerting/builtin-rules'
import { isBatchableRule } from './batch-kpi'
import { afterAll, beforeEach, expect, mock, test } from 'bun:test'

const real = { ...(await import('@chm/clickhouse-client')) }
let rows: unknown = []
let queryError = false
let beforeLimit: number | undefined
const queries: Array<{
  hostId: number
  clickhouse_settings: Record<string, unknown>
}> = []
mock.module('@chm/clickhouse-client', () => ({
  ...real,
  fetchData: async (args: {
    hostId: number
    clickhouse_settings: Record<string, unknown>
  }) => {
    queries.push(args)
    return {
      data: rows,
      metadata: { rows_before_limit_at_least: beforeLimit },
      error: queryError ? { message: 'unavailable' } : undefined,
    }
  },
}))
afterAll(() => mock.module('@chm/clickhouse-client', () => ({ ...real })))
const { queryHealthRule, mergeProgressHostKey } = await import('./rule-query')
const rule = BUILTIN_RULES.find((r) => r.id === 'stalled-merges')!
const config = {
  id: 7,
  host: 'https://example.org:8443/',
  user: 'default',
  password: '',
}
const T = 2_000_000
let current: MergeProgressSnapshot | null
let saves = 0,
  saveOk = true
const store: MergeProgressStore = {
  load: async () => current,
  save: async (_host, _previous, next) => {
    saves++
    if (saveOk) current = next
    return saveOk
  },
}
function merge(seconds: number) {
  return {
    database: 'example',
    table: 'events',
    result_part_name: 'p',
    elapsed: 600 + seconds,
    progress: 1,
    rows_read: '1',
    rows_written: '1',
    bytes_read_uncompressed: '1',
    bytes_written_uncompressed: '1',
    columns_written: '1',
  }
}
async function tick(seconds: number, mode: 'read' | 'observe' = 'observe') {
  rows = [merge(seconds)]
  return queryHealthRule(rule, config, mode, store, () => T + seconds * 1000)
}
beforeEach(() => {
  current = { version: 0, updatedAtMs: 0, samples: [] }
  saves = 0
  saveOk = true
  queryError = false
  beforeLimit = undefined
  rows = []
  queries.length = 0
})

test('the stateful rule stays outside scalar batching and queries all active merges', () => {
  expect(rule).toBeDefined()
  expect(isBatchableRule(rule)).toBe(false)
  expect(rule.sql).not.toMatch(/WHERE|LIMIT/)
  expect(rule.defaults).toEqual({ warning: 1, critical: 1 })
})
test('observing persists a continuous window; reads report a confirmed stall without writes', async () => {
  expect((await tick(0)).value).toBeNull()
  expect((await tick(600)).value).toBeNull()
  expect((await tick(1200)).value).toBe(1)
  const persisted = JSON.stringify(current)
  expect((await tick(1201, 'read')).value).toBe(1)
  expect(saves).toBe(3)
  expect(JSON.stringify(current)).toBe(persisted)
  expect(queries).toHaveLength(4)
  expect(
    queries.every(
      (q) => q.hostId === 7 && q.clickhouse_settings.readonly === '1'
    )
  ).toBe(true)
})
test('ClickHouse failures preserve evidence; a stale outage restarts the window', async () => {
  await tick(0)
  await tick(600)
  await tick(1200)
  const persisted = JSON.stringify(current)
  queryError = true
  expect((await tick(1800)).value).toBeNull()
  expect(saves).toBe(3)
  expect(JSON.stringify(current)).toBe(persisted)
  queryError = false
  expect((await tick(2400)).value).toBeNull()
})
test('malformed results never prune evidence or send a false recovery', async () => {
  await tick(0)
  await tick(600)
  await tick(1200)
  const persisted = JSON.stringify(current)
  for (const malformed of [null, {}, [{}], [merge(1800), merge(1800)]]) {
    rows = malformed
    expect(
      (
        await queryHealthRule(
          rule,
          config,
          'observe',
          store,
          () => T + 1_800_000
        )
      ).value
    ).toBeNull()
  }
  expect(saves).toBe(3)
  expect(JSON.stringify(current)).toBe(persisted)
  rows = []
  expect(
    (await queryHealthRule(rule, config, 'observe', store, () => T + 1_800_000))
      .value
  ).toBe(0)
  expect(current?.samples).toEqual([])
})
test('missing stores, failed reads, failed saves and CAS losses are unknown', async () => {
  current = null
  expect((await tick(0)).value).toBeNull()
  expect(queries).toHaveLength(0)
  current = { version: 0, updatedAtMs: 0, samples: [] }
  await tick(0)
  await tick(600)
  saveOk = false
  expect((await tick(1200)).value).toBeNull()
  rows = []
  expect(
    (await queryHealthRule(rule, config, 'observe', store, () => T + 1_800_000))
      .value
  ).toBeNull()
  expect(current?.samples).toHaveLength(1)
  const broken: MergeProgressStore = {
    load: async () => {
      throw new Error('failed')
    },
    save: async () => false,
  }
  expect((await queryHealthRule(rule, config, 'read', broken)).value).toBeNull()
})
test('stable host keys ignore list index, labels and credentials and separate endpoints', async () => {
  const a = await mergeProgressHostKey(config)
  expect(
    await mergeProgressHostKey({
      ...config,
      id: 99,
      customName: 'renamed',
      host: 'https://user:secret@example.org:8443/?token=secret',
    })
  ).toBe(a)
  expect(
    await mergeProgressHostKey({
      ...config,
      host: 'https://other.example.org/',
    })
  ).not.toBe(a)
  expect(a).toMatch(/^[0-9a-f]{64}$/)
  expect(
    await mergeProgressHostKey({ ...config, user: 'restricted' })
  ).not.toBe(a)
  expect(await mergeProgressHostKey({ ...config, password: 'rotated' })).toBe(a)
})
test('a valid truncated result cannot prune evidence or report recovery', async () => {
  await tick(0)
  await tick(600)
  await tick(1200)
  const persisted = JSON.stringify(current)
  beforeLimit = 2
  rows = [merge(1800)]
  expect(
    (await queryHealthRule(rule, config, 'observe', store, () => T + 1_800_000))
      .value
  ).toBeNull()
  rows = []
  expect(
    (await queryHealthRule(rule, config, 'observe', store, () => T + 1_800_000))
      .value
  ).toBeNull()
  expect(saves).toBe(3)
  expect(JSON.stringify(current)).toBe(persisted)
  expect(
    queries[queries.length - 1].clickhouse_settings.result_overflow_mode
  ).toBe('throw')
})
