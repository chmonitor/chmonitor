/**
 * Unit tests for the pure Postgres insight classifiers. No Postgres / store I/O
 * — the same split `operational-checks.test.ts` uses for ClickHouse. Every
 * threshold constant is exercised at its boundary.
 */

import {
  checkCacheHitRatio,
  checkConnectionSaturation,
  checkDeadTupleRatio,
  checkIdleInTransaction,
  checkLongRunningQuery,
  checkPgStatStatementsMissing,
  checkReplicationLag,
  checkRollbacksAndDeadlocks,
  checkUnusedIndexes,
  PG_CACHE_MIN_TOTAL_BLOCKS,
} from './postgres-checks'
import { describe, expect, test } from 'bun:test'

describe('checkConnectionSaturation', () => {
  test('null below the warn threshold (< 80%)', () => {
    expect(checkConnectionSaturation(79, 100)).toBeNull()
  })
  test('warning at 80%', () => {
    const c = checkConnectionSaturation(80, 100)
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('performance')
    expect(c?.metric).toBe('pg_connection_saturation')
    expect(c?.value).toBe(80)
  })
  test('critical at/above 90%', () => {
    expect(checkConnectionSaturation(90, 100)?.severity).toBe('critical')
    expect(checkConnectionSaturation(95, 100)?.severity).toBe('critical')
  })
  test('null on invalid / zero max_connections', () => {
    expect(checkConnectionSaturation(10, 0)).toBeNull()
    expect(checkConnectionSaturation(Number.NaN, 100)).toBeNull()
  })
})

describe('checkCacheHitRatio', () => {
  test('skipped when total blocks below the freshness floor', () => {
    // ratio would be 0% but denominator is tiny → not meaningful yet.
    expect(checkCacheHitRatio(1, 1)).toBeNull()
  })
  test('null when ratio is healthy (>= 90%)', () => {
    const hit = Math.round(PG_CACHE_MIN_TOTAL_BLOCKS * 0.95)
    const read = PG_CACHE_MIN_TOTAL_BLOCKS - hit
    expect(checkCacheHitRatio(hit, read)).toBeNull()
  })
  test('warning below 90% but at/above 80%', () => {
    // 85% hit ratio over a meaningful denominator.
    const total = 1_000_000
    const hit = total * 0.85
    const c = checkCacheHitRatio(hit, total - hit)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('pg_cache_hit_ratio')
  })
  test('critical below 80%', () => {
    const total = 1_000_000
    const hit = total * 0.7
    expect(checkCacheHitRatio(hit, total - hit)?.severity).toBe('critical')
  })
})

describe('checkIdleInTransaction', () => {
  test('null below 5 min', () => {
    expect(checkIdleInTransaction(299, 1)).toBeNull()
  })
  test('warning at 5 min', () => {
    const c = checkIdleInTransaction(300, 1)
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('reliability')
  })
  test('critical at/above 15 min', () => {
    expect(checkIdleInTransaction(900, 3)?.severity).toBe('critical')
  })
})

describe('checkLongRunningQuery', () => {
  test('null below 60s', () => {
    expect(checkLongRunningQuery(59)).toBeNull()
  })
  test('info between 60s and 5 min', () => {
    expect(checkLongRunningQuery(60)?.severity).toBe('info')
    expect(checkLongRunningQuery(120)?.severity).toBe('info')
  })
  test('warning at/above 5 min', () => {
    expect(checkLongRunningQuery(300)?.severity).toBe('warning')
  })
})

describe('checkPgStatStatementsMissing', () => {
  test('null when the extension is present', () => {
    expect(checkPgStatStatementsMissing(1)).toBeNull()
  })
  test('info when the extension is absent', () => {
    const c = checkPgStatStatementsMissing(0)
    expect(c?.severity).toBe('info')
    expect(c?.metric).toBe('pg_stat_statements_missing')
  })
})

describe('checkDeadTupleRatio', () => {
  test('null below 20% dead', () => {
    expect(checkDeadTupleRatio(19, 100, 'public.t')).toBeNull()
  })
  test('warning at/above 20% dead, names the table', () => {
    const c = checkDeadTupleRatio(30, 100, 'public.orders')
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('storage')
    expect(c?.title).toContain('public.orders')
  })
  test('null when live tuples are zero', () => {
    expect(checkDeadTupleRatio(10, 0, 'public.t')).toBeNull()
  })
})

describe('checkUnusedIndexes', () => {
  test('null when there are none', () => {
    expect(checkUnusedIndexes(0, [])).toBeNull()
  })
  test('info with the top offenders listed', () => {
    const c = checkUnusedIndexes(4, [
      'public.idx_a',
      'public.idx_b',
      'public.idx_c',
      'public.idx_d',
    ])
    expect(c?.severity).toBe('info')
    expect(c?.category).toBe('optimization')
    expect(c?.detail).toContain('public.idx_a')
    expect(c?.detail).toContain('+1 more')
  })
})

describe('checkReplicationLag', () => {
  test('null below 60s', () => {
    expect(checkReplicationLag(59)).toBeNull()
  })
  test('warning at/above 60s', () => {
    expect(checkReplicationLag(60)?.severity).toBe('warning')
  })
  test('critical at/above 600s', () => {
    expect(checkReplicationLag(600)?.severity).toBe('critical')
  })
})

describe('checkRollbacksAndDeadlocks', () => {
  test('null when rollback ratio is low and no deadlocks', () => {
    expect(checkRollbacksAndDeadlocks(10_000, 100, 0)).toBeNull()
  })
  test('warning on any deadlock even with low rollback ratio', () => {
    const c = checkRollbacksAndDeadlocks(10_000, 0, 5)
    expect(c?.severity).toBe('warning')
    expect(c?.value).toBe(5)
  })
  test('warning on high rollback ratio over a meaningful volume', () => {
    // 20% rollback across 10k xacts.
    const c = checkRollbacksAndDeadlocks(8_000, 2_000, 0)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('pg_rollbacks_deadlocks')
  })
  test('null when rollback ratio is high but total volume is tiny', () => {
    // Below the 1000-xact floor → not meaningful.
    expect(checkRollbacksAndDeadlocks(50, 50, 0)).toBeNull()
  })
})
