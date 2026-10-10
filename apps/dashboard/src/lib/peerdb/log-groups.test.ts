import type { FingerprintInput } from './log-fingerprint'

import {
  bucketCounts,
  extractLogTable,
  groupLogs,
  NO_TABLE_LABEL,
  splitInfoGroups,
  timeRange,
} from './log-groups'
import { describe, expect, test } from 'bun:test'

const e = (
  message: string,
  level: FingerprintInput['level'],
  mirror: string,
  ts: number | null
): FingerprintInput => ({ message, level, mirror, ts })

describe('extractLogTable', () => {
  test('reads the table from partition lines', () => {
    expect(
      extractLogTable('replicated 1 partitions to destination for table orders')
    ).toBe('orders')
    expect(extractLogTable('failed for table public.orders: timeout')).toBe(
      'public.orders'
    )
    expect(extractLogTable('for table "public"."Orders"')).toBe('public.Orders')
  })
  test('returns null when no table is named', () => {
    expect(extractLogTable('connection reset by peer')).toBeNull()
    expect(extractLogTable(undefined)).toBeNull()
  })
})

describe('groupLogs', () => {
  const rows = [
    e('replicated 1 partitions for table a', 'info', 'm1', 1),
    e('replicated 2 partitions for table a', 'info', 'm2', 2),
    e('replicated 3 partitions for table b', 'info', 'm1', 3),
    e('slot lost for table b', 'error', 'm1', 4),
    e('connection reset', 'warn', 'm3', 5),
  ]
  test('by mirror: level is the highest severity, errors sort first', () => {
    const g = groupLogs(rows, 'mirror')
    expect(g.map((x) => x.fingerprint)).toEqual(['m1', 'm3', 'm2'])
    expect(g[0].level).toBe('error')
    expect(g[0].count).toBe(3)
  })
  test('by table: lines without a table share one bucket', () => {
    const g = groupLogs(rows, 'table')
    expect(g.find((x) => x.fingerprint === NO_TABLE_LABEL)?.count).toBe(1)
    expect(g.find((x) => x.fingerprint === 'a')?.count).toBe(2)
    expect(g.find((x) => x.fingerprint === 'b')?.level).toBe('error')
  })
  test('by pattern keeps the fingerprint as label', () => {
    const g = groupLogs(rows, 'pattern')
    expect(g.some((x) => x.fingerprint.includes('<n>'))).toBe(true)
  })
})

describe('bucketCounts', () => {
  test('spreads entries across buckets and keeps the end inclusive', () => {
    const es = [0, 1, 5, 9, 10].map((ts) => ({ ts }))
    expect(bucketCounts(es, 0, 10, 5)).toEqual([2, 0, 1, 0, 2])
  })
  test('skips null and out-of-range, handles zero span', () => {
    expect(bucketCounts([{ ts: null }, { ts: 99 }], 0, 10, 3)).toEqual([
      0, 0, 0,
    ])
    expect(bucketCounts([{ ts: 5 }, { ts: 5 }], 5, 5, 3)).toEqual([0, 0, 2])
  })
})

describe('timeRange', () => {
  test('min/max, ignoring null; null when nothing is dated', () => {
    expect(timeRange([{ ts: 5 }, { ts: null }, { ts: 2 }])).toEqual({
      from: 2,
      to: 5,
    })
    expect(timeRange([{ ts: null }])).toBeNull()
  })
})

describe('splitInfoGroups', () => {
  test('collapses info only when errors or warnings exist', () => {
    const groups = [{ level: 'error' }, { level: 'info' }, { level: 'warn' }]
    const s = splitInfoGroups(groups)
    expect(s.visible.map((g) => g.level)).toEqual(['error', 'warn'])
    expect(s.collapsed).toHaveLength(1)
  })
  test('keeps info visible when it is all there is', () => {
    const s = splitInfoGroups([{ level: 'info' }, { level: 'info' }])
    expect(s.visible).toHaveLength(2)
    expect(s.collapsed).toHaveLength(0)
  })
})
