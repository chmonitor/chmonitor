/**
 * Per-card PeerDB Health status (#3701). Each card must judge its own
 * condition and name the mirror to open; an API failure must never read as a
 * healthy fleet.
 */

import type { PeerDBHealthSource } from '@/lib/health/health-status'
import type { PeerDBFleetMetrics } from '@/lib/peerdb/fleet-metrics'

import { describe, expect, test } from 'bun:test'
import {
  classifyPeerDBApiError,
  computePeerDBCheck,
} from '@/lib/health/health-status'

const metrics = (
  over: Partial<PeerDBFleetMetrics> = {}
): PeerDBFleetMetrics => ({
  totalMirrors: 4,
  byStatus: {},
  failedMirrors: [],
  pausedMirrors: [],
  terminatedMirrors: [],
  cdcMirrors: 4,
  qrepMirrors: 0,
  maxSlotLagMb: null,
  maxSlotLagLabel: null,
  totalRowsSynced: null,
  ...over,
})

const data = (over: Partial<PeerDBFleetMetrics> = {}): PeerDBHealthSource => ({
  kind: 'data',
  metrics: metrics(over),
})

describe('computePeerDBCheck', () => {
  test('a lagging slot does not paint the failures or paused card', () => {
    const src = data({ maxSlotLagMb: 50_000, maxSlotLagLabel: 'orders/slot_1' })
    expect(computePeerDBCheck('peerdb-slot-lag', src).status).toBe('critical')
    expect(computePeerDBCheck('peerdb-mirror-failures', src).status).toBe('ok')
    expect(computePeerDBCheck('peerdb-paused', src).status).toBe('ok')
  })

  test('slot lag names the mirror that owns the worst slot', () => {
    const r = computePeerDBCheck(
      'peerdb-slot-lag',
      data({ maxSlotLagMb: 50_000, maxSlotLagLabel: 'orders/slot_1' })
    )
    expect(r.mirrors).toEqual(['orders'])
    expect(r.label).toContain('orders/slot_1')
  })

  test('failures names failed mirrors before terminated ones', () => {
    const r = computePeerDBCheck(
      'peerdb-mirror-failures',
      data({ failedMirrors: ['a'], terminatedMirrors: ['b'] })
    )
    expect(r.status).toBe('warning')
    expect(r.mirrors).toEqual(['a', 'b'])
    expect(r.label).toContain('a, b')
  })

  test('three failed mirrors is critical', () => {
    const r = computePeerDBCheck(
      'peerdb-mirror-failures',
      data({ failedMirrors: ['a', 'b', 'c'] })
    )
    expect(r.status).toBe('critical')
  })

  test('paused mirrors warn but never go critical (no pause age to judge by)', () => {
    const r = computePeerDBCheck(
      'peerdb-paused',
      data({ pausedMirrors: ['p1', 'p2', 'p3', 'p4', 'p5'] })
    )
    expect(r.status).toBe('warning')
    expect(r.value).toBe(5)
    expect(r.mirrors).toHaveLength(5)
    expect(r.label).toContain('+2 more')
  })

  test('API card is critical on error and tells auth failure from unreachable', () => {
    const auth = computePeerDBCheck('peerdb-api', {
      kind: 'error',
      message:
        'Failed to fetch PeerDB metrics: PeerDB metrics request failed (401)',
    })
    expect(auth.status).toBe('critical')
    expect(auth.label).toContain('credentials')

    const down = computePeerDBCheck('peerdb-api', {
      kind: 'error',
      message:
        'Failed to fetch PeerDB metrics: PeerDB metrics request failed (502)',
    })
    expect(down.status).toBe('critical')
    expect(down.label).toContain('unreachable')

    expect(computePeerDBCheck('peerdb-api', data()).status).toBe('ok')
  })

  test('on error the data cards are unknown, never healthy', () => {
    const err: PeerDBHealthSource = { kind: 'error', message: 'x (502)' }
    for (const id of [
      'peerdb-fleet',
      'peerdb-mirror-failures',
      'peerdb-paused',
      'peerdb-slot-lag',
    ] as const) {
      expect(computePeerDBCheck(id, err).status).toBe('error')
    }
  })

  test('fleet card keeps the aggregate status and names every unhealthy mirror', () => {
    const r = computePeerDBCheck(
      'peerdb-fleet',
      data({ failedMirrors: ['f'], pausedMirrors: ['p'] })
    )
    expect(r.status).toBe('warning')
    expect(r.mirrors).toEqual(['f', 'p'])
  })

  test('loading is loading for every card', () => {
    expect(computePeerDBCheck('peerdb-api', { kind: 'loading' }).status).toBe(
      'loading'
    )
    expect(
      computePeerDBCheck('peerdb-paused', { kind: 'loading' }).status
    ).toBe('loading')
  })
})

describe('classifyPeerDBApiError', () => {
  test('401 and 403 are auth failures; anything else is unreachable', () => {
    expect(classifyPeerDBApiError('request failed (401)')).toBe('auth')
    expect(classifyPeerDBApiError('request failed (403)')).toBe('auth')
    expect(classifyPeerDBApiError('request failed (502)')).toBe('unreachable')
    expect(classifyPeerDBApiError('network error')).toBe('unreachable')
  })
})
