/**
 * MV Refresh Staleness Tests
 */

import {
  classifyMvRefresh,
  countMvIssues,
  formatMvStaleness,
  type MvRefreshRow,
} from '../mv-refresh-staleness'
import { describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// classifyMvRefresh
// ---------------------------------------------------------------------------

function makeRow(
  overrides: Partial<MvRefreshRow> = {}
): Pick<
  MvRefreshRow,
  'status' | 'staleness_seconds' | 'is_failed' | 'exception' | 'retry'
> {
  return {
    status: 'Scheduled',
    staleness_seconds: 0,
    is_failed: 0,
    exception: null,
    retry: 0,
    ...overrides,
  }
}

describe('classifyMvRefresh', () => {
  test('ok when recently refreshed', () => {
    expect(classifyMvRefresh(makeRow({ staleness_seconds: 60 }))).toBe('ok')
  })

  test('failed when exception is set, even while Scheduled', () => {
    expect(
      classifyMvRefresh(
        makeRow({ status: 'Scheduled', exception: 'timeout', retry: 1 })
      )
    ).toBe('failed')
  })

  test('failed when retry > 0 and exception is empty', () => {
    expect(classifyMvRefresh(makeRow({ status: 'Scheduled', retry: 2 }))).toBe(
      'failed'
    )
  })

  test('ok when never succeeded and exception is empty', () => {
    expect(
      classifyMvRefresh(makeRow({ status: 'Scheduled', exception: '' }))
    ).toBe('ok')
  })

  test('ok when status is Error or Failed but exception and retry are clear', () => {
    expect(classifyMvRefresh(makeRow({ status: 'Error' }))).toBe('ok')
    expect(classifyMvRefresh(makeRow({ status: 'Failed' }))).toBe('ok')
  })

  test('failed when is_failed flag is set', () => {
    expect(classifyMvRefresh(makeRow({ is_failed: 1 }))).toBe('failed')
  })

  test('stale when staleness_seconds exceeds threshold', () => {
    expect(classifyMvRefresh(makeRow({ staleness_seconds: 3601 }))).toBe(
      'stale'
    )
  })

  test('ok when staleness_seconds is exactly at threshold', () => {
    expect(classifyMvRefresh(makeRow({ staleness_seconds: 3600 }))).toBe('ok')
  })

  test('custom threshold: stale at 7200s with 7201s staleness', () => {
    expect(classifyMvRefresh(makeRow({ staleness_seconds: 7201 }), 7200)).toBe(
      'stale'
    )
  })

  test('custom threshold: ok at 7200s with 7199s staleness', () => {
    expect(classifyMvRefresh(makeRow({ staleness_seconds: 7199 }), 7200)).toBe(
      'ok'
    )
  })
})

// ---------------------------------------------------------------------------
// countMvIssues
// ---------------------------------------------------------------------------

const fullRow = (overrides: Partial<MvRefreshRow> = {}): MvRefreshRow => ({
  database: 'db',
  view: 'mv',
  status: 'Scheduled',
  last_success_time: null,
  last_refresh_time: null,
  next_refresh_time: null,
  staleness_seconds: 0,
  is_failed: 0,
  exception: null,
  retry: 0,
  ...overrides,
})

describe('countMvIssues', () => {
  test('all ok → no issues', () => {
    const rows = [
      fullRow({ staleness_seconds: 100 }),
      fullRow({ staleness_seconds: 200 }),
    ]
    const result = countMvIssues(rows)
    expect(result.failed).toBe(0)
    expect(result.stale).toBe(0)
    expect(result.total).toBe(2)
  })

  test('counts failed views correctly', () => {
    const rows = [
      fullRow({ status: 'Scheduled', exception: 'boom', retry: 1 }),
      fullRow({ status: 'Scheduled', retry: 2 }),
      fullRow({ staleness_seconds: 100 }),
    ]
    const result = countMvIssues(rows)
    expect(result.failed).toBe(2)
    expect(result.stale).toBe(0)
    expect(result.total).toBe(3)
  })

  test('counts stale views correctly', () => {
    const rows = [
      fullRow({ staleness_seconds: 7200 }),
      fullRow({ staleness_seconds: 3601 }),
    ]
    const result = countMvIssues(rows)
    expect(result.stale).toBe(2)
    expect(result.failed).toBe(0)
  })

  test('mixed failed and stale', () => {
    const rows = [
      fullRow({ exception: 'boom' }),
      fullRow({ staleness_seconds: 5000 }),
      fullRow({ staleness_seconds: 100 }),
    ]
    const result = countMvIssues(rows)
    expect(result.failed).toBe(1)
    expect(result.stale).toBe(1)
    expect(result.total).toBe(3)
  })

  test('empty array → all zeros', () => {
    expect(countMvIssues([])).toEqual({ failed: 0, stale: 0, total: 0 })
  })
})

// ---------------------------------------------------------------------------
// formatMvStaleness
// ---------------------------------------------------------------------------

describe('formatMvStaleness', () => {
  test('seconds for < 60s', () => {
    expect(formatMvStaleness(45)).toBe('45s')
  })

  test('minutes for < 3600s', () => {
    expect(formatMvStaleness(120)).toBe('2m')
  })

  test('hours for < 86400s', () => {
    expect(formatMvStaleness(7200)).toBe('2h')
  })

  test('days for >= 86400s', () => {
    expect(formatMvStaleness(172800)).toBe('2d')
  })
})
