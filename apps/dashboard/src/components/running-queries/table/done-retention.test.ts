import type { RunningQueryRow } from './types'

import { reconcileDoneRows } from './done-retention'
import { describe, expect, test } from 'bun:test'

const row = (
  query_id: string,
  extra: Partial<RunningQueryRow> = {}
): RunningQueryRow => ({
  query_id,
  query: `SELECT ${query_id}`,
  ...extra,
})

describe('reconcileDoneRows — retain expanded queries that just finished', () => {
  test('retains a finished row the user had expanded', () => {
    const next = reconcileDoneRows(
      new Map(),
      [row('a')],
      new Set(),
      new Set(['a'])
    )
    expect(next.has('a')).toBe(true)
    expect(next.get('a')?.query).toBe('SELECT a')
  })

  test('ignores a finished row that was not expanded', () => {
    const next = reconcileDoneRows(new Map(), [row('a')], new Set(), new Set())
    expect(next.size).toBe(0)
  })

  test('ignores a "finished" row that is still present this poll', () => {
    const next = reconcileDoneRows(
      new Map(),
      [row('a')],
      new Set(['a']),
      new Set(['a'])
    )
    expect(next.size).toBe(0)
  })

  test('drops a retained row that is running again', () => {
    const prev = new Map([['a', row('a')]])
    const next = reconcileDoneRows(prev, [], new Set(['a']), new Set(['a']))
    expect(next.has('a')).toBe(false)
  })

  test('keeps an already-retained row that is still gone', () => {
    const prev = new Map([['a', row('a')]])
    const next = reconcileDoneRows(prev, [], new Set(), new Set(['a']))
    expect(next.has('a')).toBe(true)
    // No change → same reference so a state setter can bail out.
    expect(next).toBe(prev)
  })

  test('returns the same reference when nothing changed', () => {
    const prev = new Map<string, RunningQueryRow>()
    // A finished-but-unexpanded row is a no-op.
    expect(reconcileDoneRows(prev, [row('a')], new Set(), new Set())).toBe(prev)
  })

  test('does not mutate the previous map', () => {
    const prev = new Map<string, RunningQueryRow>()
    reconcileDoneRows(prev, [row('a')], new Set(), new Set(['a']))
    expect(prev.size).toBe(0)
  })

  test('ignores finished rows without a query_id', () => {
    const next = reconcileDoneRows(
      new Map(),
      [row('')],
      new Set(),
      new Set([''])
    )
    expect(next.size).toBe(0)
  })
})
