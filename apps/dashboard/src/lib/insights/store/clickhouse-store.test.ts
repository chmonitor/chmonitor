/**
 * Tests for the ClickHouse insights backend (the default). It is a thin adapter
 * over lib/findings/findings-store, so these tests mock that module and assert
 * delegation: `record` fans a batch out to recordFinding and ANDs the results;
 * `list` passes straight through to listRecentFindings.
 *
 * We mock the findings-store module (not the underlying ClickHouse client) so
 * this stays a pure delegation test and does not collide with
 * findings-store.test.ts, which exercises the real module against a mocked
 * client.
 */

import type { Finding, FindingRow } from './types'

import { peerdbInsightStoreHostId, pgInsightStoreHostId } from '../types'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mutable hooks the mock reads so each test controls behavior.
let recordResults: boolean[] = []
let recordCalls: Array<{ hostId: number; finding: Finding }> = []
let recordThrows = false
let listImpl: () => Promise<FindingRow[]> = async () => []
let listCalls: Array<{ hostId: number; opts: unknown }> = []

mock.module('@/lib/findings/findings-store', () => ({
  recordFinding: async (hostId: number, finding: Finding) => {
    recordCalls.push({ hostId, finding })
    if (recordThrows) throw new Error('simulated recordFinding rejection')
    return recordResults.shift() ?? true
  },
  listRecentFindings: (hostId: number, opts: unknown) => {
    listCalls.push({ hostId, opts })
    return listImpl()
  },
}))

const warnings: string[] = []
mock.module('@chm/logger', () => ({
  ErrorLogger: {
    logWarning: (msg: string) => {
      warnings.push(msg)
    },
  },
}))

const { ClickHouseInsightsStore } = await import('./clickhouse-store')

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'info',
  category: 'storage',
  source: 'ai-insight',
  title: 't',
  ...over,
})

beforeEach(() => {
  recordResults = []
  recordCalls = []
  recordThrows = false
  listCalls = []
  listImpl = async () => []
})

describe('ClickHouseInsightsStore', () => {
  test('exposes the clickhouse backend id', () => {
    expect(new ClickHouseInsightsStore().backend).toBe('clickhouse')
  })

  test('record fans the batch out to recordFinding (one call per finding)', async () => {
    const store = new ClickHouseInsightsStore()
    const ok = await store.record(2, [
      finding({ title: 'a' }),
      finding({ title: 'b' }),
    ])
    expect(ok).toBe(true)
    expect(recordCalls.map((c) => c.finding.title)).toEqual(['a', 'b'])
    expect(recordCalls.every((c) => c.hostId === 2)).toBe(true)
  })

  test('record returns false if any single write fails (best-effort AND)', async () => {
    recordResults = [true, false]
    const store = new ClickHouseInsightsStore()
    expect(await store.record(0, [finding(), finding()])).toBe(false)
  })

  test('record short-circuits an empty batch without touching the store', async () => {
    const store = new ClickHouseInsightsStore()
    expect(await store.record(0, [])).toBe(true)
    expect(recordCalls).toHaveLength(0)
  })

  test('record returns false (does NOT throw) when the delegate rejects', async () => {
    // The InsightsStore contract is no-throw; a recordFinding rejection must be
    // swallowed into a false result, not propagated.
    recordThrows = true
    const store = new ClickHouseInsightsStore()
    expect(await store.record(0, [finding()])).toBe(false)
  })

  test('list delegates straight through to listRecentFindings', async () => {
    const row: FindingRow = {
      event_time: '2026-06-20 00:00:00',
      host_id: '0',
      severity: 'critical',
      category: 'anomaly',
      source: 'ai-insight',
      title: 'spike',
      detail: '',
      metric: 'error_rate',
      value: 5,
    }
    listImpl = async () => [row]
    const store = new ClickHouseInsightsStore()
    const out = await store.list(0, { since: '6 HOUR', limit: 50 })
    expect(out).toEqual([row])
    expect(listCalls).toEqual([
      { hostId: 0, opts: { since: '6 HOUR', limit: 50 } },
    ])
  })

  test('reserved PeerDB/Postgres keys never reach the ClickHouse delegate and warn once', async () => {
    warnings.length = 0
    const store = new ClickHouseInsightsStore()
    const peerdb = peerdbInsightStoreHostId(0)
    const pg = pgInsightStoreHostId(3)

    expect(await store.record(peerdb, [finding(), finding()])).toBe(false)
    expect(await store.record(peerdb, [finding()])).toBe(false)
    expect(await store.list(peerdb)).toEqual([])
    expect(await store.record(pg, [finding()])).toBe(false)
    expect(await store.list(pg)).toEqual([])

    expect(recordCalls).toHaveLength(0)
    expect(listCalls).toHaveLength(0)
    // One notice per engine, each naming the backend that can persist them.
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('peerdb')
    expect(warnings[1]).toContain('postgres')
    for (const w of warnings) {
      expect(w).toContain('INSIGHTS_STORE_BACKEND=postgres|d1')
    }
  })

  test('a normal host index is unaffected and logs no decline notice', async () => {
    warnings.length = 0
    const store = new ClickHouseInsightsStore()
    expect(await store.record(1, [finding()])).toBe(true)
    await store.list(1)
    expect(recordCalls).toHaveLength(1)
    expect(listCalls).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })
})
