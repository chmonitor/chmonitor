/**
 * Unit tests for the pure PeerDB insight classifiers. No PeerDB / store I/O —
 * the same split `postgres-checks.test.ts` uses. Every threshold constant is
 * exercised at its boundary.
 */

import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_TREND_CRITICAL_MB,
  SLOT_LAG_TREND_MIN_POINTS,
  SLOT_LAG_TREND_WARN_MB,
  SLOT_LAG_WARN_MB,
} from '../peerdb/slot-lag-thresholds'
import {
  checkFailedMirrors,
  checkMirrorErrors,
  checkPausedMirrors,
  checkSlotLag,
  checkSlotLagTrend,
  checkSnapshotStalled,
  checkTerminatedMirrors,
  PEERDB_MIRROR_ERRORS_CRIT,
} from './peerdb-checks'
import { PEERDB_SOURCE_ID } from './read-peerdb-insights'
import { insightKey } from './types'
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

describe('checkTerminatedMirrors', () => {
  test('null when none terminated', () => {
    expect(checkTerminatedMirrors([])).toBeNull()
  })
  test('warning, not critical — a teardown is often deliberate', () => {
    const c = checkTerminatedMirrors(['pg_to_ch'])
    expect(c?.severity).toBe('warning')
    expect(c?.category).toBe('reliability')
    expect(c?.metric).toBe('peerdb_terminated_mirrors')
    expect(c?.value).toBe(1)
    expect(c?.action?.href).toBe('/peerdb')
  })
  test('ignores blank names', () => {
    expect(checkTerminatedMirrors(['', '  ' as unknown as string])).toBeNull()
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

describe('checkSlotLagTrend', () => {
  /** Ascending series whose first→last delta is exactly `growth`. */
  const series = (growth: number) => {
    const base = 100
    return [base, base, base + growth / 2, base + growth]
  }

  test('declines below the minimum point count', () => {
    const short = [0, 1, 2].slice(0, SLOT_LAG_TREND_MIN_POINTS - 1)
    expect(checkSlotLagTrend(short, null)).toBeNull()
    expect(checkSlotLagTrend([], null)).toBeNull()
  })

  test('declines one point below the warn growth', () => {
    expect(
      checkSlotLagTrend(series(SLOT_LAG_TREND_WARN_MB - 1), null)
    ).toBeNull()
  })

  test('warning exactly at the warn growth — even while below SLOT_LAG_WARN_MB', () => {
    // The whole point: 100 → 228 MiB never crosses the 512 MiB absolute line,
    // but it is diverging fast enough to be worth a look.
    const c = checkSlotLagTrend(series(SLOT_LAG_TREND_WARN_MB), 'pg/slot')
    expect(c?.severity).toBe('warning')
    expect(c?.metric).toBe('peerdb_slot_lag_trend')
    expect(c?.value).toBe(SLOT_LAG_TREND_WARN_MB)
    expect(c?.action?.href).toBe('/peerdb/peers')
    expect(series(SLOT_LAG_TREND_WARN_MB).at(-1)).toBeLessThan(SLOT_LAG_WARN_MB)
  })

  test('warning one below / critical at the critical growth', () => {
    expect(
      checkSlotLagTrend(series(SLOT_LAG_TREND_CRITICAL_MB - 1), null)?.severity
    ).toBe('warning')
    expect(
      checkSlotLagTrend(series(SLOT_LAG_TREND_CRITICAL_MB), null)?.severity
    ).toBe('critical')
  })

  test('a falling series is recovery, not divergence', () => {
    expect(checkSlotLagTrend([900, 700, 500, 100], null)).toBeNull()
  })

  test('flat series does not fire', () => {
    expect(checkSlotLagTrend([400, 400, 400, 400], null)).toBeNull()
  })

  test('non-finite points are dropped, not read as zero', () => {
    // If the gaps were coerced to 0 the series would look like a collapse and
    // the check would stay silent about a real climb.
    // A LEADING gap is the discriminator: coerced to 0 the series would start at
    // 0 and read 540 MiB of growth (critical); dropped, it starts at the first
    // real reading and reads 140 MiB (warning).
    const withGaps = [null, 400, 410, 420, Number.NaN, 540]
    expect(checkSlotLagTrend(withGaps, null)?.severity).toBe('warning')
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
    // Per-mirror identity rides in the metric, not a count in the title.
    expect(c?.metric).toBe('peerdb_mirror_errors:m')
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
  test('two mirrors produce two distinct metrics, so both keep a dismissal', () => {
    expect(checkMirrorErrors('pg_to_ch', 3)?.metric).not.toBe(
      checkMirrorErrors('pg_to_s3', 3)?.metric
    )
  })
  test('the slug is case-insensitive and separator-stable', () => {
    // Same identity as the alert rule id uses, so an insight dismissal and an
    // ACK cannot land on two different keys for one mirror.
    expect(checkMirrorErrors('PG_to_CH', 3)?.metric).toBe(
      checkMirrorErrors('pg_to_ch', 3)?.metric
    )
    expect(checkMirrorErrors('pg to ch', 3)?.metric).toBe(
      checkMirrorErrors('PG-TO-CH', 3)?.metric
    )
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
    expect(c?.metric).toBe('peerdb_snapshot_stalled:m')
    expect(c?.value).toBe(3)
    expect(c?.action?.href).toBe('/peerdb')
  })
  test('null on missing mirror', () => {
    expect(checkSnapshotStalled('', 4, 1)).toBeNull()
  })
})

describe('identity determinism (the dismissal survives regeneration)', () => {
  /**
   * The key is `peerdb:<id>:<category>:<metric>:<title>`, so a run-varying value
   * in EITHER the metric or the title re-keys the card on the next sweep and the
   * user's dismissal resurrects the finding.
   */
  const keyOf = (c: ReturnType<typeof checkFailedMirrors>) =>
    c ? insightKey(PEERDB_SOURCE_ID, c, 'peerdb') : null

  test('a fleet-wide card keeps its key as the count changes', () => {
    const one = keyOf(checkFailedMirrors(['a']))
    const three = keyOf(checkFailedMirrors(['a', 'b', 'c']))
    const oneAgain = keyOf(
      checkFailedMirrors(['a', 'b', 'c', 'd', 'e'].slice(0, 1))
    )
    expect(one).toBe(three)
    expect(one).toBe(oneAgain)
    // …while the value still updates.
    expect(checkFailedMirrors(['a'])?.value).toBe(1)
    expect(checkFailedMirrors(['a', 'b', 'c'])?.value).toBe(3)
  })

  test('the failing title carries no count', () => {
    const title = checkFailedMirrors(['a', 'b', 'c'])?.title ?? ''
    expect(title).toBe('PeerDB: mirrors are failing')
    expect(title).not.toMatch(/\d/)
  })

  test('every PeerDB card title is count-free and "PeerDB:"-prefixed', () => {
    const cards = [
      checkFailedMirrors(['a', 'b', 'c']),
      checkPausedMirrors(['a', 'b', 'c']),
      checkTerminatedMirrors(['a', 'b', 'c']),
      checkSlotLag(SLOT_LAG_CRITICAL_MB, 'pg/slot'),
      checkSlotLagTrend([0, 100, 400, 900], 'pg/slot'),
      checkMirrorErrors('pg_to_ch', 42),
      checkSnapshotStalled('pg_to_ch', 40, 3),
    ]
    for (const card of cards) {
      expect(card).not.toBeNull()
      expect(card?.title.startsWith('PeerDB: ')).toBe(true)
      // Per-mirror cards may name the flow; none may carry a measurement.
      expect(card?.title.replace(/\bpg[a-z0-9_-]*\b/gi, '')).not.toMatch(/\d/)
    }
  })

  test('a lag reading changes the value but not the key', () => {
    const low = keyOf(
      checkSlotLag(SLOT_LAG_CRITICAL_MB, null)
    ) as unknown as string
    const high = keyOf(checkSlotLag(SLOT_LAG_CRITICAL_MB * 4, null))
    expect(high).toBe(low)
  })
})
