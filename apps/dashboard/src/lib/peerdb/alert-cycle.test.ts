import type { DispatchFindingParams } from '@/lib/health/sweep/dispatch/types'
import type { PeerDBAlertSnapshotReader } from './alert-collector'
import type { PeerDBAuditFn } from './alert-cycle'

import {
  PEERDB_ALERT_HOST_ID,
  peerDBRuleIdForFlow,
  runPeerDBAlertCycle,
} from './alert-cycle'
import { afterEach, describe, expect, test } from 'bun:test'
import { alertStateStore } from '@/lib/health/alert-state-store'

function readerFor(
  mirrors: Array<{
    name: string
    status?: string | null
    errorMessage?: string | null
    lagSec?: number | null
    errorCount?: number
    errorSource?: 'log-api' | 'unavailable'
  }>
): PeerDBAlertSnapshotReader {
  return {
    listMirrors: async () => mirrors.map((m) => ({ name: m.name })),
    mirrorStatus: async (name) => {
      const m = mirrors.find((x) => x.name === name)
      if (!m) return null
      return {
        currentFlowState: m.status ?? 'STATUS_RUNNING',
        ...(m.errorMessage ? { errorMessage: m.errorMessage } : {}),
        ...(m.lagSec !== undefined ? { lagSec: m.lagSec } : {}),
      }
    },
    mirrorErrorCount: async (name) => {
      const m = mirrors.find((x) => x.name === name)
      return {
        count: m?.errorCount ?? 0,
        source: m?.errorSource ?? 'log-api',
      }
    },
    peerSlots: async () => [],
    listSourcePeers: async () => [],
  }
}

interface Tape {
  order: string[]
  dispatches: DispatchFindingParams[]
  audits: Array<{ decisionKind: string; delivered: boolean }>
}

function tape(): Tape & {
  dispatch: (p: DispatchFindingParams) => Promise<void>
  audit: PeerDBAuditFn
} {
  const t: Tape = { order: [], dispatches: [], audits: [] }
  return {
    ...t,
    dispatch: async (p) => {
      t.order.push(`dispatch:${p.ruleId}`)
      t.dispatches.push(p)
    },
    audit: async (a) => {
      t.order.push(`audit:${a.decisionKind}`)
      t.audits.push({ decisionKind: a.decisionKind, delivered: a.delivered })
    },
  }
}

const RULE = (flow: string) => peerDBRuleIdForFlow(flow)
const KEY = (flow: string) => `${PEERDB_ALERT_HOST_ID}:${RULE(flow)}`

afterEach(() => {
  // The cycle peeks the shared singleton for recovery detection — never leak
  // seeded records between tests.
  for (const key of [...alertStateStore.entries()].map(([k]) => k)) {
    if (key.startsWith(`${PEERDB_ALERT_HOST_ID}:`)) alertStateStore.delete(key)
  }
})

describe('runPeerDBAlertCycle', () => {
  test('dry-run default audits the hold but never dispatches', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-dry', status: 'STATUS_FAILED' }]),
      dispatch: t.dispatch,
      audit: t.audit,
    })
    expect(res.findings).toHaveLength(1)
    expect(res.dispatched).toBe(0)
    expect(res.audited).toBe(1)
    expect(t.dispatches).toHaveLength(0)
    expect(t.audits[0]!.decisionKind).toBe('peerdb-hold:dry-run')
  })

  test('live run audits BEFORE dispatching (ordering enforced)', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-order', status: 'STATUS_FAILED' }]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.dispatched).toBe(1)
    expect(t.order).toEqual([
      'audit:peerdb-predelivery',
      `dispatch:${RULE('cycle-order')}`,
    ])
    const d = t.dispatches[0]!
    expect(d.hostId).toBe(PEERDB_ALERT_HOST_ID)
    expect(d.ruleType).toBe('peerdb')
    expect(d.severity).toBe('critical')
  })

  test('validation failure is held and audited, never dispatched', async () => {
    const t = tape()
    // A flow name that survives slugging but formats into an over-long title
    // is impractical; instead poison via errorMessage secret text.
    const res = await runPeerDBAlertCycle({
      reader: readerFor([
        {
          name: 'cycle-leak',
          status: 'STATUS_FAILED',
          errorMessage: 'failed with password=hunter2 inline',
        },
      ]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.dispatched).toBe(0)
    expect(t.dispatches).toHaveLength(0)
    expect(t.audits[0]!.decisionKind).toContain('validation-failed')
    expect(t.audits[0]!.decisionKind).toContain('possible-secret-leak')
  })

  test('ok with no prior record is skipped silently (no audit, no dispatch)', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-quiet', status: 'STATUS_RUNNING' }]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.findings).toHaveLength(0)
    expect(res.dispatched).toBe(0)
    expect(res.audited).toBe(0)
  })

  test('ok with a firing record dispatches a recovery', async () => {
    alertStateStore.set(KEY('cycle-recover'), {
      severity: 'critical',
      updatedAt: Date.now() - 1000,
      notifiedAt: Date.now() - 1000,
    })
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-recover', status: 'STATUS_RUNNING' }]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.dispatched).toBe(1)
    expect(t.dispatches[0]!.severity).toBe('ok')
    expect(t.order[0]).toBe('audit:peerdb-predelivery')
  })

  test('unavailable error logs do not clear a persisted incident', async () => {
    alertStateStore.set(KEY('cycle-recover-errors'), {
      severity: 'critical',
      updatedAt: Date.now() - 1000,
      notifiedAt: Date.now() - 1000,
    })
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([
        {
          name: 'cycle-recover-errors',
          status: 'STATUS_RUNNING',
          errorSource: 'unavailable',
        },
      ]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })

    expect(res.dispatched).toBe(0)
    expect(res.audited).toBe(1)
    expect(t.audits[0]!.decisionKind).toBe(
      'peerdb-hold:recovery-data-unavailable'
    )
    expect(alertStateStore.get(KEY('cycle-recover-errors'))?.severity).toBe(
      'critical'
    )
  })

  test('an unreadable status endpoint does not clear a persisted incident', async () => {
    alertStateStore.set(KEY('cycle-recover-status'), {
      severity: 'warning',
      updatedAt: Date.now() - 1000,
      notifiedAt: Date.now() - 1000,
    })
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: {
        listMirrors: async () => [
          { name: 'cycle-recover-status', status: 'STATUS_RUNNING' },
        ],
        mirrorStatus: async () => null,
        mirrorErrorCount: async () => ({ count: 0, source: 'log-api' }),
        peerSlots: async () => [],
        listSourcePeers: async () => [],
      },
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })

    expect(res.dispatched).toBe(0)
    expect(res.audited).toBe(1)
    expect(t.audits[0]!.decisionKind).toBe(
      'peerdb-hold:recovery-data-unavailable'
    )
    expect(alertStateStore.get(KEY('cycle-recover-status'))?.severity).toBe(
      'warning'
    )
  })

  test('warning maps to warning dispatch with reason-chosen thresholds', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-lag', lagSec: 600 }]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.dispatched).toBe(1)
    const d = t.dispatches[0]!
    expect(d.severity).toBe('warning')
    expect(d.value).toBe(600)
    expect(d.warnThreshold).toBe(300)
    expect(d.critThreshold).toBe(1800)
  })

  test('unavailable error count never blocks a status-fired alert', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([
        {
          name: 'cycle-ambig',
          status: 'STATUS_FAILED',
          errorSource: 'unavailable',
        },
      ]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.dispatched).toBe(1)
    expect(t.dispatches[0]!.label).toContain('error count unavailable')
  })

  test('an exploding reader degrades to counters, never throws', async () => {
    const exploding: PeerDBAlertSnapshotReader = {
      listMirrors: async () => {
        throw new Error('down')
      },
      mirrorStatus: async () => null,
      mirrorErrorCount: async () => ({ count: 0, source: 'unavailable' }),
      peerSlots: async () => [],
      listSourcePeers: async () => [],
    }
    const res = await runPeerDBAlertCycle({
      reader: exploding,
      audit: async () => {},
    })
    expect(res.skipped).toBe(true)
    expect(res.dispatched).toBe(0)
  })
})
