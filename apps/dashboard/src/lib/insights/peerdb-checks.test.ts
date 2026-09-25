/**
 * Unit tests for the pure PeerDB insight classifiers. No PeerDB / store I/O —
 * the same split `postgres-checks.test.ts` uses. Every threshold constant is
 * exercised at its boundary.
 */

import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_WARN_MB,
} from '../peerdb/slot-lag-thresholds'
import {
  checkFailedMirrors,
  checkMirrorErrors,
  checkPausedMirrors,
  checkSlotLag,
  checkSnapshotStalled,
  PEERDB_MIRROR_ERRORS_CRIT,
} from './peerdb-checks'
import { describe, expect, test } from 'bun:test'

describe('checkFailedMirrors', () => {
  test('null when no mirrors failed', () => {
    expect(checkFailedMirrors([])).toBeNull()
  })
  test('critical card for failed mirrors', () => {
    const c = checkFailedMirrors(['pg_to_ch'])
    expect(c?.severity).toBe('critical')
    expect(c?.category).toBe('reliability')
    expect(c?.metric).toBe('peerdb_failed_mirrors')
    expect(c?.value).toBe(1)
    expect(c?.action?.href).toBe('/peerdb')
  })
  test('truncates long lists with a +N more suffix', () => {
    const c = checkFailedMirrors(['a', 'b', 'c', 'd'])
    expect(c?.value).toBe(4)
    expect(c?.detail).toContain('+1 more')
  })
  test('ignores blank names', () => {
    expect(checkFailedMirrors(['', '  ' as unknown as string])).toBeNull()
  })
})

describe('checkPausedMirrors', () => {
  test('null when none paused', () => {
    expect(checkPausedMirrors([])).toBeNull()
  })
  test('info card (paused is not paging-worthy)', () => {
    const c = checkPausedMirrors(['pg_to_ch'])
    expect(c?.severity).toBe('info')
    expect(c?.metric).toBe('peerdb_paused_mirrors')
    expect(c?.action?.href).toBe('/peerdb')
  })
})

describe('checkSlotLag', () => {
  test('null below the warn threshold', () => {
    expect(checkSlotLag(SLOT_LAG_WARN_MB - 1, null)).toBeNull()
  })
  test('null when lag is unknown', () => {
    expect(checkSlotLag(null, null)).toBeNull()
    expect(checkSlotLag(Number.NaN, null)).toBeNull()
  })
  test('warning at the warn threshold', () => {
    const c = checkSlotLag(SLOT_LAG_WARN_MB, 'pg/slot')
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('peerdb_slot_lag_mb')
    expect(c?.action?.href).toBe('/peerdb/peers')
    expect(c?.detail).toContain('pg/slot')
  })
  test('critical at/above the critical threshold', () => {
    expect(checkSlotLag(SLOT_LAG_CRITICAL_MB, null)?.severity).toBe('critical')
  })
})

describe('checkMirrorErrors', () => {
  test('null for silence and near-silence (< 3)', () => {
    expect(checkMirrorErrors('m', 0)).toBeNull()
    expect(checkMirrorErrors('m', 2)).toBeNull()
  })
  test('warning at 3 errors', () => {
    const c = checkMirrorErrors('m', 3)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('peerdb_mirror_errors')
  })
  test('critical at the escalation threshold', () => {
    expect(checkMirrorErrors('m', PEERDB_MIRROR_ERRORS_CRIT)?.severity).toBe(
      'critical'
    )
  })
  test('null on missing mirror / invalid count', () => {
    expect(checkMirrorErrors('', 5)).toBeNull()
    expect(checkMirrorErrors('m', Number.NaN)).toBeNull()
  })
})

describe('checkSnapshotStalled', () => {
  test('null when complete or no tables', () => {
    expect(checkSnapshotStalled('m', 4, 4)).toBeNull()
    expect(checkSnapshotStalled('m', 0, 0)).toBeNull()
  })
  test('warning card with remaining table count as value', () => {
    const c = checkSnapshotStalled('m', 4, 1)
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('peerdb_snapshot_stalled')
    expect(c?.value).toBe(3)
    expect(c?.action?.href).toBe('/peerdb')
  })
  test('null on missing mirror', () => {
    expect(checkSnapshotStalled('', 4, 1)).toBeNull()
  })
})
