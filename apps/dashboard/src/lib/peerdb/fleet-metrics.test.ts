/**
 * Unit tests for the pure PeerDB fleet-metrics summarizer. No fetch / env I/O —
 * every input is an in-memory payload shaped like the allowlisted upstream
 * responses.
 */

import { normalizeFleetStatus, summarizePeerDBFleet } from './fleet-metrics'
import { describe, expect, test } from 'bun:test'

describe('normalizeFleetStatus', () => {
  test('buckets the known lifecycle states', () => {
    expect(normalizeFleetStatus('STATUS_RUNNING')).toBe('running')
    expect(normalizeFleetStatus('STATUS_FAILED')).toBe('failed')
    expect(normalizeFleetStatus('STATUS_PAUSED')).toBe('paused')
    expect(normalizeFleetStatus('STATUS_PAUSING')).toBe('paused')
    expect(normalizeFleetStatus('STATUS_SNAPSHOT')).toBe('snapshot')
    expect(normalizeFleetStatus('STATUS_SETUP')).toBe('snapshot')
    expect(normalizeFleetStatus('STATUS_TERMINATED')).toBe('terminated')
  })
  test('unknown / missing states bucket as unknown', () => {
    expect(normalizeFleetStatus('STATUS_UNKNOWN')).toBe('unknown')
    expect(normalizeFleetStatus(undefined)).toBe('unknown')
    expect(normalizeFleetStatus('WEIRD_NEW_STATE')).toBe('unknown')
  })
})

describe('summarizePeerDBFleet', () => {
  test('empty input yields the empty summary without throwing', () => {
    const s = summarizePeerDBFleet({})
    expect(s.totalMirrors).toBe(0)
    expect(s.failedMirrors).toEqual([])
    expect(s.maxSlotLagMb).toBeNull()
    expect(s.totalRowsSynced).toBeNull()
  })

  test('counts by status and splits CDC vs QRep', () => {
    const s = summarizePeerDBFleet({
      mirrors: [
        { name: 'a', isCdc: true, status: 'STATUS_RUNNING' },
        { name: 'b', isCdc: false, status: 'STATUS_FAILED' },
        { name: 'c', isCdc: true, status: 'STATUS_PAUSED' },
      ],
    })
    expect(s.totalMirrors).toBe(3)
    expect(s.byStatus).toMatchObject({ running: 1, failed: 1, paused: 1 })
    expect(s.failedMirrors).toEqual(['b'])
    expect(s.pausedMirrors).toEqual(['c'])
    expect(s.cdcMirrors).toBe(2)
    expect(s.qrepMirrors).toBe(1)
  })

  test('per-mirror status refines the list-row status', () => {
    const s = summarizePeerDBFleet({
      mirrors: [{ name: 'a', status: 'STATUS_RUNNING' }],
      statuses: new Map([['a', { currentFlowState: 'STATUS_FAILED' }]]),
    })
    expect(s.byStatus.failed).toBe(1)
    expect(s.failedMirrors).toEqual(['a'])
  })

  test('worst slot lag wins with a mirror/slot label', () => {
    const s = summarizePeerDBFleet({
      mirrors: [{ name: 'a' }],
      slots: [
        { name: 'pg', slots: [{ slotName: 's1', lagInMb: 100 }] },
        { name: 'pg2', slots: [{ slotName: 's2', lagInMb: 900 }] },
      ],
    })
    expect(s.maxSlotLagMb).toBe(900)
    expect(s.maxSlotLagLabel).toBe('pg2/s2')
  })

  test('string lag values coerce; garbage is skipped', () => {
    const s = summarizePeerDBFleet({
      slots: [
        {
          name: 'pg',
          slots: [
            { lagInMb: '750' as unknown as number },
            { lagInMb: Number.NaN },
          ],
        },
      ],
    })
    expect(s.maxSlotLagMb).toBe(750)
  })

  test('rows synced sums the per-mirror readings', () => {
    const s = summarizePeerDBFleet({
      rowsSynced: new Map([
        ['a', 100],
        ['b', 200],
      ]),
    })
    expect(s.totalRowsSynced).toBe(300)
  })

  test('nameless rows are ignored for totals', () => {
    const s = summarizePeerDBFleet({
      mirrors: [{ name: '' }, { name: 'ok' }],
    })
    expect(s.totalMirrors).toBe(1)
  })
})
