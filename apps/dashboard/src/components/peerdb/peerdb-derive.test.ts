import {
  batchDurationSec,
  cloneProgress,
  EAGER_METRICS_LIMIT,
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_WARN_MB,
  shouldEagerLoadMetrics,
  slotHealth,
} from './peerdb-derive'
import { describe, expect, test } from 'bun:test'

describe('batchDurationSec', () => {
  test('computes seconds between ISO start and end', () => {
    expect(
      batchDurationSec({
        startTime: '2026-07-11T00:00:00.000Z',
        endTime: '2026-07-11T00:00:08.000Z',
      })
    ).toBe(8)
  })

  test('accepts epoch-second numeric strings', () => {
    // parseTs treats < 1e11 as epoch seconds.
    expect(batchDurationSec({ startTime: '1000', endTime: '1090' })).toBe(90)
  })

  test('returns null when an endpoint is missing', () => {
    expect(batchDurationSec({ startTime: '2026-07-11T00:00:00Z' })).toBeNull()
    expect(batchDurationSec({ endTime: '2026-07-11T00:00:00Z' })).toBeNull()
    expect(batchDurationSec({})).toBeNull()
  })

  test('clamps negative spans (clock skew) to 0', () => {
    expect(
      batchDurationSec({
        startTime: '2026-07-11T00:00:08.000Z',
        endTime: '2026-07-11T00:00:00.000Z',
      })
    ).toBe(0)
  })
})

describe('cloneProgress', () => {
  test('percent from partitions completed vs total', () => {
    const p = cloneProgress({
      numPartitionsCompleted: 3,
      numPartitionsTotal: 12,
    })
    expect(p.completed).toBe(3)
    expect(p.total).toBe(12)
    expect(p.pct).toBe(25)
    expect(p.done).toBe(false)
  })

  test('done when fetch + consolidate complete, forces 100%', () => {
    const p = cloneProgress({
      numPartitionsCompleted: 8,
      numPartitionsTotal: 10,
      fetchCompleted: true,
      consolidateCompleted: true,
    })
    expect(p.done).toBe(true)
    expect(p.pct).toBe(100)
  })

  test('not done when only one phase complete', () => {
    const p = cloneProgress({
      numPartitionsCompleted: 5,
      numPartitionsTotal: 10,
      fetchCompleted: true,
      consolidateCompleted: false,
    })
    expect(p.done).toBe(false)
    expect(p.pct).toBe(50)
  })

  test('zero total yields 0% without dividing by zero', () => {
    const p = cloneProgress({
      numPartitionsCompleted: 0,
      numPartitionsTotal: 0,
    })
    expect(p.pct).toBe(0)
    expect(Number.isFinite(p.pct)).toBe(true)
  })

  test('clamps over-100 partition counters', () => {
    const p = cloneProgress({
      numPartitionsCompleted: 15,
      numPartitionsTotal: 10,
    })
    expect(p.pct).toBe(100)
  })
})

describe('slotHealth', () => {
  test('ok for low lag, active, reserved', () => {
    expect(
      slotHealth({ lagInMb: 12, active: true, walStatus: 'reserved' })
    ).toBe('ok')
  })

  test('warn once lag crosses the warning threshold', () => {
    expect(
      slotHealth({
        lagInMb: SLOT_LAG_WARN_MB,
        active: true,
        walStatus: 'reserved',
      })
    ).toBe('warn')
  })

  test('critical once lag crosses the critical threshold', () => {
    expect(
      slotHealth({
        lagInMb: SLOT_LAG_CRITICAL_MB,
        active: true,
        walStatus: 'reserved',
      })
    ).toBe('critical')
  })

  test('critical for unreserved / lost WAL regardless of lag', () => {
    expect(slotHealth({ lagInMb: 1, walStatus: 'unreserved' })).toBe('critical')
    expect(slotHealth({ lagInMb: 1, walStatus: 'lost' })).toBe('critical')
  })

  test('inactive slot holding WAL past warn is critical', () => {
    expect(
      slotHealth({
        lagInMb: SLOT_LAG_WARN_MB,
        active: false,
        walStatus: 'reserved',
      })
    ).toBe('critical')
  })

  test('inactive slot with negligible lag is still ok', () => {
    expect(
      slotHealth({ lagInMb: 2, active: false, walStatus: 'reserved' })
    ).toBe('ok')
  })
})

describe('shouldEagerLoadMetrics', () => {
  // Regression: page-level KPIs/sparklines/lag-triage aggregate from per-row
  // metrics. Before the fix, a fleet larger than the budget loaded NO row
  // metrics until a row was expanded, so every page total rendered as 0.
  test('the first row always loads on mount, even for huge fleets', () => {
    // A 500-mirror fleet must still populate at least the top rows on mount so
    // the header totals are non-zero before any expansion.
    expect(shouldEagerLoadMetrics(0)).toBe(true)
    expect(shouldEagerLoadMetrics(EAGER_METRICS_LIMIT - 1)).toBe(true)
  })

  test('rows past the budget load lazily (on expand), capping API fan-out', () => {
    expect(shouldEagerLoadMetrics(EAGER_METRICS_LIMIT)).toBe(false)
    expect(shouldEagerLoadMetrics(499)).toBe(false)
  })

  test('small fleets load every row eagerly', () => {
    // A 10-mirror fleet: indices 0..9 are all within the budget.
    for (let i = 0; i < 10; i++) {
      expect(shouldEagerLoadMetrics(i)).toBe(true)
    }
  })

  test('respects a custom limit and rejects negative indices', () => {
    expect(shouldEagerLoadMetrics(4, 5)).toBe(true)
    expect(shouldEagerLoadMetrics(5, 5)).toBe(false)
    expect(shouldEagerLoadMetrics(-1)).toBe(false)
  })
})
