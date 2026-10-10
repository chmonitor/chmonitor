import type { DispatchFindingParams } from '@/lib/health/sweep/dispatch/types'
import type { PeerDBAlertSnapshotReader } from './alert-collector'
import type { PeerDBAuditFn } from './alert-cycle'

import {
  PEERDB_ALERT_HOST_ID,
  PEERDB_API_HEALTH_RULE_ID,
  PEERDB_COVERAGE_PARTIAL_DECISION,
  peerDBRuleIdForFlow,
  runPeerDBAlertCycle,
} from './alert-cycle'
import { fingerprintLogMessage } from './log-fingerprint'
import {
  PEERDB_LOG_PATTERN_SPIKE_COUNT,
  peerDBLogPatternRuleId,
} from './log-pattern-alerts'
import { PeerDBError } from './peerdb-config'
import { afterEach, describe, expect, test } from 'bun:test'
import { alertStateStore, evaluateAlert } from '@/lib/health/alert-state-store'

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
      // STATUS_SNAPSHOT is not in the FAIL/WARN state sets, so it classifies
      // `ok` — and because it is not STATUS_RUNNING the ERROR-log read IS
      // issued (#3677), so its `unavailable` is observable and the recovery
      // hold below applies.
      reader: readerFor([
        {
          name: 'cycle-recover-errors',
          status: 'STATUS_SNAPSHOT',
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

  // -------------------------------------------------------------------------
  // #3687 — coverage reaches the SWEEP OUTPUT and the AUDIT ROW
  //
  // An operator reads the sweep summary and the `alert_events` rows, not the
  // collector's return value, so the partial signal is asserted at those two
  // boundaries rather than inside the collector.
  // -------------------------------------------------------------------------

  test('a 72-mirror fleet reports complete coverage in the cycle result', async () => {
    const mirrors = Array.from({ length: 72 }, (_, i) => ({
      name: `cycle-fleet-${i}`,
      status: 'STATUS_RUNNING' as const,
    }))
    const res = await runPeerDBAlertCycle({
      reader: readerFor(mirrors),
      audit: async () => {},
      budgetMs: 10_000,
    })
    expect(res.mirrorsListed).toBe(72)
    expect(res.mirrorsChecked).toBe(72)
    expect(res.partial).toBe(false)
    expect(res.unchecked).toBe(0)
  })

  test('a mirror failing past 50 is classified and becomes a finding', async () => {
    // The bug this issue closes: a failure at position 60 previously produced
    // no signal at all, because the collector sliced the list to 50 and the
    // cycle sliced signals to 50 again.
    const mirrors = Array.from({ length: 72 }, (_, i) => ({
      name: `cycle-deep-${i}`,
      status:
        i === 60 ? ('STATUS_FAILED' as const) : ('STATUS_RUNNING' as const),
    }))
    const res = await runPeerDBAlertCycle({
      reader: readerFor(mirrors),
      audit: async () => {},
      budgetMs: 10_000,
    })
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]!.checkId).toBe(RULE('cycle-deep-60'))
    expect(res.findings[0]!.severity).toBe('critical')
  })

  test('a guarded run reaches the sweep output as partial + unchecked', async () => {
    const mirrors = Array.from({ length: 72 }, (_, i) => ({
      name: `cycle-guard-${i}`,
      status: 'STATUS_RUNNING' as const,
    }))
    const res = await runPeerDBAlertCycle({
      reader: readerFor(mirrors),
      audit: async () => {},
      maxMirrors: 50,
      budgetMs: 10_000,
    })
    expect(res.mirrorsListed).toBe(72)
    expect(res.mirrorsChecked).toBe(50)
    expect(res.partial).toBe(true)
    expect(res.unchecked).toBe(22)
  })

  test('a budget-truncated run reports partial at the sweep boundary', async () => {
    // No guard, tight budget, slow reads: the budget is the only bound left,
    // so this is the shape a huge fleet lands in.
    const names = Array.from({ length: 120 }, (_, i) => ({
      name: `cycle-slow-${i}`,
    }))
    const res = await runPeerDBAlertCycle({
      reader: {
        listMirrors: async () => names,
        mirrorStatus: async () => {
          await new Promise((r) => setTimeout(r, 40))
          return { currentFlowState: 'STATUS_RUNNING' }
        },
        mirrorErrorCount: async () => ({
          count: 0,
          source: 'log-api' as const,
        }),
        peerSlots: async () => [],
        listSourcePeers: async () => [],
      },
      audit: async () => {},
      concurrency: 2,
      budgetMs: 150,
    })
    expect(res.mirrorsListed).toBe(120)
    expect(res.mirrorsChecked).toBeLessThan(120)
    expect(res.partial).toBe(true)
    expect(res.unchecked).toBe(120 - res.mirrorsChecked)
  })

  test('a partial run writes an audit row saying so, before any mirror is evaluated', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor(
        Array.from({ length: 72 }, (_, i) => ({
          name: `cycle-audit-${i}`,
          status: 'STATUS_RUNNING' as const,
        }))
      ),
      audit: t.audit,
      maxMirrors: 50,
      budgetMs: 10_000,
    })
    const coverageRow = t.audits.find(
      (a) => a.decisionKind === PEERDB_COVERAGE_PARTIAL_DECISION
    )
    expect(coverageRow).toBeDefined()
    expect(coverageRow!.delivered).toBe(false)
    expect(res.audited).toBe(1)
    // Fleet-level, not attributed to one mirror.
    expect(t.audits).toHaveLength(1)
  })

  test('a complete run writes no coverage audit row', async () => {
    const t = tape()
    await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'cycle-complete', status: 'STATUS_RUNNING' }]),
      audit: t.audit,
      budgetMs: 10_000,
    })
    expect(
      t.audits.some((a) => a.decisionKind === PEERDB_COVERAGE_PARTIAL_DECISION)
    ).toBe(false)
  })

  test('the coverage audit row names the counts and the shortfall', async () => {
    const rows: Array<{ error?: string; value?: number | null }> = []
    await runPeerDBAlertCycle({
      reader: readerFor(
        Array.from({ length: 72 }, (_, i) => ({
          name: `cycle-row-${i}`,
          status: 'STATUS_RUNNING' as const,
        }))
      ),
      audit: async (a) => {
        rows.push({ error: a.error, value: a.value })
      },
      maxMirrors: 50,
      budgetMs: 10_000,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.error).toContain('50 of 72 mirrors checked')
    expect(rows[0]!.error).toContain('22 unchecked')
    expect(rows[0]!.value).toBe(22)
  })

  test('a partial run still evaluates every mirror it did read', async () => {
    // Truncation must not become "skip the whole tick": the readable mirrors
    // are still classified, and the coverage row records what was missed.
    const mirrors = Array.from({ length: 60 }, (_, i) => ({
      name: `cycle-still-${i}`,
      status:
        i === 3 ? ('STATUS_FAILED' as const) : ('STATUS_RUNNING' as const),
    }))
    const res = await runPeerDBAlertCycle({
      reader: readerFor(mirrors),
      audit: async () => {},
      maxMirrors: 50,
      budgetMs: 10_000,
    })
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]!.checkId).toBe(RULE('cycle-still-3'))
    expect(res.partial).toBe(true)
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
    // A failed list call is an outage finding now, never a silent skip (#3675).
    expect(res.skipped).toBe(false)
    expect(res.findings.map((f) => f.checkId)).toEqual([
      PEERDB_API_HEALTH_RULE_ID,
    ])
    expect(res.dispatched).toBe(0)
  })
})

// #3675: PeerDB unreachable / auth failed must fire an alert and recover, not
// read as an empty fleet. One fleet-level key so an outage is one incident.
describe('runPeerDBAlertCycle — PeerDB API health', () => {
  const API_KEY = `${PEERDB_ALERT_HOST_ID}:${PEERDB_API_HEALTH_RULE_ID}`

  function failingReader(err: unknown): PeerDBAlertSnapshotReader {
    return {
      ...readerFor([]),
      listMirrors: async () => {
        throw err
      },
    }
  }

  test('auth failure fires one critical fleet finding, audited before dispatch', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: failingReader(new PeerDBError('401', 401, 'auth')),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.skipped).toBe(false)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]).toMatchObject({
      hostName: 'peerdb',
      checkId: PEERDB_API_HEALTH_RULE_ID,
      severity: 'critical',
      title: 'PeerDB API auth failed',
    })
    expect(t.order).toEqual([
      'audit:peerdb-predelivery',
      `dispatch:${PEERDB_API_HEALTH_RULE_ID}`,
    ])
    expect(t.dispatches[0]).toMatchObject({
      hostId: PEERDB_ALERT_HOST_ID,
      hostName: 'peerdb',
      ruleId: PEERDB_API_HEALTH_RULE_ID,
      severity: 'critical',
    })
  })

  test('unreachable is labelled unreachable', async () => {
    const res = await runPeerDBAlertCycle({
      reader: failingReader(
        new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
      ),
      audit: async () => {},
    })
    expect(res.findings[0]!.title).toBe('PeerDB API unreachable')
    expect(res.findings[0]!.label).toContain('dns')
  })

  test('recovers when the list call answers again, even with zero mirrors', async () => {
    alertStateStore.set(API_KEY, {
      severity: 'critical',
      updatedAt: Date.now() - 1000,
      notifiedAt: Date.now() - 1000,
    })
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(res.findings).toHaveLength(0)
    expect(t.order).toEqual([
      'audit:peerdb-predelivery',
      `dispatch:${PEERDB_API_HEALTH_RULE_ID}`,
    ])
    expect(t.dispatches[0]).toMatchObject({
      ruleId: PEERDB_API_HEALTH_RULE_ID,
      severity: 'ok',
    })
  })

  test('a healthy API with no prior incident sends nothing', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: readerFor([{ name: 'api-ok', status: 'STATUS_RUNNING' }]),
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })
    expect(
      t.dispatches.some((d) => d.ruleId === PEERDB_API_HEALTH_RULE_ID)
    ).toBe(false)
    expect(res.findings).toHaveLength(0)
  })

  test('dry-run audits the failure but never dispatches', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: failingReader(new PeerDBError('500', 500, 'upstream')),
      dispatch: t.dispatch,
      audit: t.audit,
    })
    expect(res.findings).toHaveLength(1)
    expect(res.dispatched).toBe(0)
    expect(t.order).toEqual(['audit:peerdb-hold:dry-run'])
  })
})

describe('runPeerDBAlertCycle — log patterns (#3700)', () => {
  const MSG = (i: number) =>
    `connection to 10.0.0.${i}:5432 refused after ${i + 1} retries`
  const PATTERN_RULE = peerDBLogPatternRuleId(fingerprintLogMessage(MSG(0)))
  const PATTERN_KEY = `${PEERDB_ALERT_HOST_ID}:${PATTERN_RULE}`

  /** Failing mirrors whose ERROR-log reads return `perMirror` messages. */
  function patternReader(
    names: string[],
    perMirror = 1,
    source: 'log-api' | 'unavailable' = 'log-api'
  ): PeerDBAlertSnapshotReader {
    return {
      ...readerFor(names.map((name) => ({ name, status: 'STATUS_FAILED' }))),
      mirrorErrorCount: async (name) => {
        const i = names.indexOf(name)
        const messages = Array.from({ length: perMirror }, () => MSG(i))
        return { count: messages.length, source, messages }
      },
    }
  }

  /** Dispatch that commits state like the real `dispatchFinding`. */
  function committingTape() {
    const t = tape()
    return {
      ...t,
      dispatch: async (p: DispatchFindingParams) => {
        await t.dispatch(p)
        evaluateAlert(alertStateStore, {
          hostId: p.hostId,
          ruleId: p.ruleId,
          severity: p.severity,
        }).commit()
      },
    }
  }
  const patternDispatches = (t: Tape) =>
    t.dispatches.filter((d) => d.ruleId.startsWith('peerdb-log-pattern:'))
  const live = (
    reader: PeerDBAlertSnapshotReader,
    t: ReturnType<typeof committingTape>
  ) =>
    runPeerDBAlertCycle({
      reader,
      dispatch: t.dispatch,
      audit: t.audit,
      dryRun: false,
    })

  test('40 mirrors with the same pattern yield exactly one pattern finding', async () => {
    const t = committingTape()
    const names = Array.from({ length: 40 }, (_, i) => `pat_${i}`)
    const res = await live(patternReader(names), t)
    const findings = res.findings.filter((f) => f.checkId === PATTERN_RULE)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.value).toBe(40)
    expect(findings[0]!.label).toContain('across 40 mirrors')
    const pd = patternDispatches(t)
    expect(pd).toHaveLength(1)
    expect(pd[0]!.severity).toBe('warning')
    // Audit-before-delivery holds for the pattern too.
    const i = t.order.indexOf(`dispatch:${PATTERN_RULE}`)
    expect(t.order[i - 1]).toBe('audit:peerdb-predelivery')
  })

  test('a new pattern fires once, then not again while it persists', async () => {
    const t = committingTape()
    for (let tick = 0; tick < 3; tick++) {
      await live(patternReader(['once_a', 'once_b']), t)
    }
    expect(patternDispatches(t)).toHaveLength(1)
    expect(alertStateStore.get(PATTERN_KEY)?.severity).toBe('warning')
  })

  test('spike boundary: threshold - 1 stays quiet, threshold escalates to critical', async () => {
    const t = committingTape()
    await live(patternReader(['spike_a'], 1), t)
    await live(
      patternReader(['spike_a'], PEERDB_LOG_PATTERN_SPIKE_COUNT - 1),
      t
    )
    expect(patternDispatches(t).map((d) => d.severity)).toEqual(['warning'])
    await live(patternReader(['spike_a'], PEERDB_LOG_PATTERN_SPIKE_COUNT), t)
    expect(patternDispatches(t).map((d) => d.severity)).toEqual([
      'warning',
      'critical',
    ])
  })

  test('recovers when the pattern disappears on a complete read', async () => {
    const t = committingTape()
    await live(patternReader(['rec_a']), t)
    await live(patternReader(['rec_a'], 0), t)
    expect(patternDispatches(t).map((d) => d.severity)).toEqual([
      'warning',
      'ok',
    ])
    expect(alertStateStore.get(PATTERN_KEY)).toBeUndefined()
  })

  test('an unavailable log read holds the pattern recovery', async () => {
    const t = committingTape()
    await live(patternReader(['hold_a']), t)
    await live(patternReader(['hold_a'], 0, 'unavailable'), t)
    expect(patternDispatches(t)).toHaveLength(1)
    expect(t.audits.map((a) => a.decisionKind)).toContain(
      'peerdb-hold:recovery-data-unavailable'
    )
    expect(alertStateStore.get(PATTERN_KEY)?.severity).toBe('warning')
  })

  test('dry-run audits the pattern but never dispatches it', async () => {
    const t = tape()
    const res = await runPeerDBAlertCycle({
      reader: patternReader(['dry_a']),
      dispatch: t.dispatch,
      audit: t.audit,
    })
    expect(res.findings.some((f) => f.checkId === PATTERN_RULE)).toBe(true)
    expect(t.dispatches).toHaveLength(0)
  })
})
