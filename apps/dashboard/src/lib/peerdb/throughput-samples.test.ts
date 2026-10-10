/**
 * Throughput-zero check (#3728): a running CDC mirror whose `rowsSynced`
 * total stops growing must warn — but only once there is an earlier sample to
 * compare against, and never when the sample store is unavailable.
 */

import type { PeerDBAlertSnapshotReader } from './alert-collector'
import type { PeerDBRule } from './alert-rules'
import type { MirrorStatusResponse } from './types'

import { runPeerDBAlertCycle } from './alert-cycle'
import { classifyPeerDBMirror } from './alerting'
import { DEFAULT_PEERDB_ALERT_THRESHOLDS } from './alerting-thresholds'
import {
  type PeerDBThroughputSamples,
  type PeerDBThroughputStore,
  stepThroughputSample,
} from './throughput-samples'
import { describe, expect, test } from 'bun:test'

/** In-memory stand-in for the health-DB table; `fail` simulates a DB error. */
class MemoryThroughputStore implements PeerDBThroughputStore {
  rows: PeerDBThroughputSamples = new Map()
  fail = false
  async load() {
    if (this.fail) return null
    return new Map(this.rows)
  }
  async save(upserts: PeerDBThroughputSamples, deletes: readonly string[]) {
    for (const [k, v] of upserts) this.rows.set(k, v)
    for (const k of deletes) this.rows.delete(k)
  }
}

const MIN = 60_000
const T0 = 1_800_000_000_000

function reader(
  name: string,
  state: { rows: number; status?: string; kind?: 'cdc' | 'qrep' }
): PeerDBAlertSnapshotReader {
  return {
    listMirrors: async () => [{ name }],
    mirrorStatus: async (): Promise<MirrorStatusResponse> => ({
      currentFlowState: (state.status ??
        'STATUS_RUNNING') as MirrorStatusResponse['currentFlowState'],
      ...(state.kind === 'qrep'
        ? { qrepStatus: { partitions: [] } }
        : { cdcStatus: { rowsSynced: state.rows } }),
    }),
    mirrorErrorCount: async () => ({ count: 0, source: 'log-api' }),
    peerSlots: async () => [],
    listSourcePeers: async () => [],
  }
}

async function tick(
  name: string,
  state: { rows: number; status?: string; kind?: 'cdc' | 'qrep' },
  now: number,
  store: PeerDBThroughputStore | null,
  rules: PeerDBRule[] = []
) {
  return runPeerDBAlertCycle({
    reader: reader(name, state),
    throughputStore: store,
    rules,
    now,
    audit: async () => {},
  })
}

describe('stepThroughputSample', () => {
  test('first sample has no flat time', () => {
    expect(stepThroughputSample(null, 10, T0).flatSec).toBeNull()
  })
  test('a changed total (growth or reset) restarts the window', () => {
    const prev = { rowsSynced: 10, sinceMs: T0 }
    expect(stepThroughputSample(prev, 11, T0 + MIN)).toEqual({
      next: { rowsSynced: 11, sinceMs: T0 + MIN },
      flatSec: 0,
    })
    expect(stepThroughputSample(prev, 3, T0 + MIN).flatSec).toBe(0)
  })
  test('same total keeps the original since', () => {
    const prev = { rowsSynced: 10, sinceMs: T0 }
    expect(stepThroughputSample(prev, 10, T0 + 5 * MIN)).toEqual({
      next: prev,
      flatSec: 300,
    })
  })
})

describe('throughput-zero in the alert cycle', () => {
  test('same total for longer than the threshold warns', async () => {
    const store = new MemoryThroughputStore()
    await tick('tp-flat', { rows: 100 }, T0, store)
    const res = await tick('tp-flat', { rows: 100 }, T0 + 31 * MIN, store)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]!.severity).toBe('warning')
    expect(res.findings[0]!.value).toBe(31 * 60)
    expect(res.findings[0]!.label).toContain('no new rows for 31m')
    // Default has no critical: a day of flat total is still only a warning.
    const later = await tick(
      'tp-flat',
      { rows: 100 },
      T0 + 24 * 60 * MIN,
      store
    )
    expect(later.findings[0]!.severity).toBe('warning')
  })

  test('same total under the threshold stays ok', async () => {
    const store = new MemoryThroughputStore()
    await tick('tp-short', { rows: 100 }, T0, store)
    const res = await tick('tp-short', { rows: 100 }, T0 + 29 * MIN, store)
    expect(res.findings).toHaveLength(0)
  })

  test('a growing total is ok', async () => {
    const store = new MemoryThroughputStore()
    await tick('tp-grow', { rows: 100 }, T0, store)
    await tick('tp-grow', { rows: 200 }, T0 + 31 * MIN, store)
    const res = await tick('tp-grow', { rows: 300 }, T0 + 62 * MIN, store)
    expect(res.findings).toHaveLength(0)
  })

  test('first tick (no earlier sample) is no finding, and seeds the store', async () => {
    const store = new MemoryThroughputStore()
    const res = await tick('tp-first', { rows: 100 }, T0, store)
    expect(res.findings).toHaveLength(0)
    expect(store.rows.get('tp-first')).toEqual({
      rowsSynced: 100,
      sinceMs: T0,
    })
  })

  test('store unavailable skips the check', async () => {
    const res1 = await tick('tp-nostore', { rows: 100 }, T0, null)
    const res2 = await tick('tp-nostore', { rows: 100 }, T0 + 120 * MIN, null)
    expect(res1.findings).toHaveLength(0)
    expect(res2.findings).toHaveLength(0)
  })

  test('a failed DB read skips the check and writes nothing', async () => {
    const store = new MemoryThroughputStore()
    await tick('tp-dbfail', { rows: 100 }, T0, store)
    store.fail = true
    const res = await tick('tp-dbfail', { rows: 100 }, T0 + 120 * MIN, store)
    expect(res.findings).toHaveLength(0)
    expect(store.rows.get('tp-dbfail')?.sinceMs).toBe(T0)
  })

  test('QRep and non-running mirrors are excluded', async () => {
    const store = new MemoryThroughputStore()
    await tick('tp-qrep', { rows: 5, kind: 'qrep' }, T0, store)
    const qrep = await tick(
      'tp-qrep',
      { rows: 5, kind: 'qrep' },
      T0 + 120 * MIN,
      store
    )
    expect(qrep.findings).toHaveLength(0)

    await tick('tp-paused', { rows: 5 }, T0, store)
    await tick(
      'tp-paused',
      { rows: 5, status: 'STATUS_PAUSED' },
      T0 + MIN,
      store
    )
    // Resumed with the same total: the paused time does not count.
    const resumed = await tick('tp-paused', { rows: 5 }, T0 + 120 * MIN, store)
    expect(resumed.findings).toHaveLength(0)
  })

  test('a throughput-zero rule overrides the threshold', async () => {
    const rule: PeerDBRule = {
      id: 'r1',
      check: 'throughput-zero',
      matchKind: 'exact',
      match: 'tp-rule',
      warning: 300,
      critical: 600,
      severity: 'critical',
      enabled: true,
      muteUntil: null,
    }
    const store = new MemoryThroughputStore()
    await tick('tp-rule', { rows: 1 }, T0, store, [rule])
    const warn = await tick('tp-rule', { rows: 1 }, T0 + 6 * MIN, store, [rule])
    expect(warn.findings[0]!.severity).toBe('warning')
    const crit = await tick('tp-rule', { rows: 1 }, T0 + 11 * MIN, store, [
      rule,
    ])
    expect(crit.findings[0]!.severity).toBe('critical')
  })
})

describe('classifyPeerDBMirror throughput-zero', () => {
  test('uses the throughput-zero reason code and ignores non-CDC', () => {
    const base = {
      flowName: 'x',
      status: 'STATUS_RUNNING',
      rowsFlatSec: 3600,
      errorCountSource: 'skipped' as const,
    }
    expect(
      classifyPeerDBMirror(
        { ...base, isCdc: true },
        DEFAULT_PEERDB_ALERT_THRESHOLDS
      ).reasons
    ).toContain('throughput-zero-warning')
    expect(
      classifyPeerDBMirror(
        { ...base, isCdc: false },
        DEFAULT_PEERDB_ALERT_THRESHOLDS
      ).severity
    ).toBe('ok')
  })
})
