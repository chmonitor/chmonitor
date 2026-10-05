import type { PeerDBAlertSnapshotReader } from './alert-collector'
import type { PeerDBFetchFailure } from './peerdb-config'

import {
  collectPeerDBSignals,
  PEERDB_ALERT_MAX_MIRRORS,
} from './alert-collector'
import { classifyPeerDBMirror } from './alerting'
import {
  classifyPeerDBFetchFailure,
  describePeerDBFailure,
  PeerDBError,
  peerDBFailureLabel,
  peerdbFetch,
} from './peerdb-config'
import {
  DEFAULT_PEERDB_SWEEP_CONCURRENCY,
  mapWithPool,
  PEERDB_SWEEP_MAX_CONCURRENCY,
  resolvePeerDBSweepConcurrency,
} from './sweep-pool'
import { afterEach, describe, expect, test } from 'bun:test'

function stubReader(
  overrides: Partial<PeerDBAlertSnapshotReader> = {}
): PeerDBAlertSnapshotReader {
  return {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => ({ count: 0, source: 'log-api' }),
    peerSlots: async () => [],
    listSourcePeers: async () => [],
    ...overrides,
  }
}

describe('collectPeerDBSignals', () => {
  test('empty when no mirrors listed', async () => {
    const out = await collectPeerDBSignals(stubReader())
    expect(out.signals).toEqual([])
    expect(out.metrics.mirrorsChecked).toBe(0)
  })

  test('builds a signal from status + error count + slot lag via sourceName', async () => {
    // Not STATUS_RUNNING, so the ERROR-log read is issued (#3677 skip rule).
    const out = await collectPeerDBSignals(
      stubReader({
        listMirrors: async () => [
          { name: 'pg_to_ch', sourceName: 'pg', status: 'STATUS_FAILED' },
        ],
        mirrorStatus: async () => ({
          currentFlowState: 'STATUS_FAILED',
          lagSec: 45,
        }),
        mirrorErrorCount: async () => ({ count: 2, source: 'log-api' }),
        listSourcePeers: async () => ['pg'],
        peerSlots: async () => [{ slotName: 's', lagInMb: 12 }],
      })
    )
    expect(out.signals).toHaveLength(1)
    const s = out.signals[0]!
    expect(s.flowName).toBe('pg_to_ch')
    expect(s.status).toBe('STATUS_FAILED')
    expect(s.lagSec).toBe(45)
    expect(s.recentErrorCount).toBe(2)
    expect(s.errorCountSource).toBe('log-api')
    expect(s.slotLagMb).toBe(12)
    expect(out.metrics.hasLagSample).toBe(true)
    expect(out.metrics.hasErrorSample).toBe(true)
    expect(out.metrics.hasSlotSample).toBe(true)
    expect(out.fleetMaxSlotLagMb).toBe(12)
  })

  test('unavailable error source is preserved, never coerced to zero-ok', async () => {
    const out = await collectPeerDBSignals(
      stubReader({
        // FAILED, so the logs read IS issued and its failure is observable.
        listMirrors: async () => [{ name: 'm' }],
        mirrorStatus: async () => ({ currentFlowState: 'STATUS_FAILED' }),
        mirrorErrorCount: async () => ({ count: 0, source: 'unavailable' }),
      })
    )
    expect(out.signals[0]!.errorCountSource).toBe('unavailable')
    expect(out.metrics.hasErrorSample).toBe(false)
  })

  test('marks snapshot stalled only after PEERDB_SNAPSHOT_STALL_MS', async () => {
    const hoursAgo = (h: number) =>
      new Date(Date.now() - h * 3_600_000).toISOString()
    const reader = (done: boolean, startTime?: string) =>
      stubReader({
        listMirrors: async () => [{ name: 'm' }],
        mirrorStatus: async () => ({
          currentFlowState: 'STATUS_SNAPSHOT',
          cdcStatus: {
            snapshotStatus: {
              clones: [
                {
                  tableName: 't',
                  fetchCompleted: done,
                  consolidateCompleted: done,
                  startTime,
                },
              ],
            },
          },
        }),
      })
    const stalled = async (r: PeerDBAlertSnapshotReader) =>
      (await collectPeerDBSignals(r)).signals[0]!.snapshotStalled
    // in progress is not an alert
    expect(await stalled(reader(false, hoursAgo(1)))).toBe(false)
    expect(await stalled(reader(false, hoursAgo(25)))).toBe(true)
    // age unknown: never claim a stall that cannot be shown
    expect(await stalled(reader(false))).toBe(false)
    // age is measured from the earliest clone start, not the newest
    expect(
      await stalled(
        stubReader({
          listMirrors: async () => [{ name: 'm' }],
          mirrorStatus: async () => ({
            currentFlowState: 'STATUS_SNAPSHOT',
            cdcStatus: {
              snapshotStatus: {
                clones: [
                  { tableName: 'a', startTime: hoursAgo(1) },
                  { tableName: 'b', startTime: hoursAgo(25) },
                ],
              },
            },
          }),
        })
      )
    ).toBe(true)
    // finished snapshot is never stalled, however old
    expect(await stalled(reader(true, hoursAgo(25)))).toBe(false)
  })

  test('never throws on a totally failing reader', async () => {
    const failing: PeerDBAlertSnapshotReader = {
      listMirrors: async () => {
        throw new Error('down')
      },
      mirrorStatus: async () => {
        throw new Error('down')
      },
      mirrorErrorCount: async () => {
        throw new Error('down')
      },
      peerSlots: async () => {
        throw new Error('down')
      },
      listSourcePeers: async () => {
        throw new Error('down')
      },
    }
    const out = await collectPeerDBSignals(failing)
    expect(out.signals).toEqual([])
  })

  test('one bad mirror does not block the rest', async () => {
    const out = await collectPeerDBSignals(
      stubReader({
        listMirrors: async () => [{ name: 'good' }, { name: 'bad' }],
        mirrorStatus: async (name) => {
          if (name === 'bad') throw new Error('boom')
          return { currentFlowState: 'STATUS_RUNNING' }
        },
      })
    )
    expect(out.signals).toHaveLength(2)
    expect(out.metrics.errored).toBe(1)
  })

  test('caps collection at 50 mirrors', async () => {
    const names = Array.from({ length: 60 }, (_, i) => ({ name: `m${i}` }))
    const out = await collectPeerDBSignals(
      stubReader({ listMirrors: async () => names })
    )
    expect(out.metrics.mirrorsChecked).toBe(50)
    expect(out.signals).toHaveLength(50)
  })
})

// ---------------------------------------------------------------------------
// #3677 — fan-out bounds, healthy-skip, and error classification
// ---------------------------------------------------------------------------

/**
 * Reader that simulates a PeerDB fleet with per-call latency and records peak
 * in-flight counts per method. `latencyMs` models the measured 0.3s–10s range
 * of `POST /v1/mirrors/logs` on a saturated catalog.
 */
function fleetReader(opts: {
  count: number
  latencyMs?: number
  logsLatencyMs?: number
  statusOf?: (i: number) => {
    currentFlowState: string
    errorMessage?: string
  }
  countFromLogs?: (i: number) => number
}) {
  const latencyMs = opts.latencyMs ?? 0
  const logsLatencyMs = opts.logsLatencyMs ?? latencyMs
  const calls = { status: 0, logs: 0 }
  const inFlight = { status: 0, logs: 0 }
  const peak = { status: 0, logs: 0 }
  const logsFor: string[] = []

  const track = (kind: 'status' | 'logs', delay: number) => {
    calls[kind]++
    inFlight[kind]++
    peak[kind] = Math.max(peak[kind], inFlight[kind])
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        inFlight[kind]--
        resolve()
      }, delay)
    })
  }

  const reader: PeerDBAlertSnapshotReader = {
    listMirrors: async () =>
      Array.from({ length: opts.count }, (_, i) => ({
        name: `m${i}`,
        sourceName: 'pg',
      })),
    mirrorStatus: async (name) => {
      await track('status', latencyMs)
      const i = Number(name.slice(1))
      return opts.statusOf?.(i) ?? { currentFlowState: 'STATUS_RUNNING' }
    },
    mirrorErrorCount: async (name) => {
      await track('logs', logsLatencyMs)
      logsFor.push(name)
      const i = Number(name.slice(1))
      return {
        count: opts.countFromLogs?.(i) ?? 0,
        source: 'log-api' as const,
      }
    },
    peerSlots: async () => [],
    listSourcePeers: async () => [],
  }
  return { reader, calls, peak, logsFor }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('collectPeerDBSignals concurrency bound (#3677)', () => {
  test('peak in-flight never exceeds the configured pool size', async () => {
    // 24 mirrors at 20ms each. Unbounded, this would peak at 24; the pool of 4
    // must cap it at 4 for BOTH the status and the logs call.
    const { reader, peak } = fleetReader({
      count: 24,
      latencyMs: 20,
      statusOf: () => ({ currentFlowState: 'STATUS_FAILED' }),
    })

    await collectPeerDBSignals(reader, { concurrency: 4, budgetMs: 10_000 })

    expect(peak.status).toBeGreaterThan(1)
    expect(peak.status).toBeLessThanOrEqual(4)
    expect(peak.logs).toBeGreaterThan(1)
    expect(peak.logs).toBeLessThanOrEqual(4)
  })

  test('pool of 1 serialises every call', async () => {
    const { reader, peak } = fleetReader({
      count: 6,
      latencyMs: 10,
      statusOf: () => ({ currentFlowState: 'STATUS_FAILED' }),
    })

    await collectPeerDBSignals(reader, { concurrency: 1, budgetMs: 10_000 })

    expect(peak.status).toBe(1)
    expect(peak.logs).toBe(1)
  })

  test('the pool bounds wall time — sequential-equivalent work is parallelised, not serialised', async () => {
    // 16 mirrors x 100ms. Serial execution would need 1.6s (and 3.2s with
    // logs). A pool of 8 must finish well inside the 3.2s serial bound, and
    // inside the budget. This is the assertion that the fix is a POOL and not
    // "144 sequential timeouts".
    const { reader } = fleetReader({
      count: 16,
      latencyMs: 100,
      statusOf: () => ({ currentFlowState: 'STATUS_FAILED' }),
    })

    const started = Date.now()
    const out = await collectPeerDBSignals(reader, {
      concurrency: 8,
      budgetMs: 10_000,
    })
    const elapsed = Date.now() - started

    expect(out.metrics.mirrorsChecked).toBe(16)
    expect(out.metrics.budgetDeferred).toBe(0)
    // 2 waves of status + 2 waves of logs = ~400ms. Well under the 3.2s a
    // fully serial fan-out would need, with headroom for a loaded host.
    expect(elapsed).toBeLessThan(1_500)
  })

  test('a pool alone still overruns — the budget bounds total wall time', async () => {
    // Pool of 4 over 16 mirrors where EVERY call takes 300ms. Uncapped, the
    // fan-out needs 8 waves x 300ms = 2.4s per stage. With a 400ms budget the
    // collection must return near the budget, not near 2.4s: a bounded pool by
    // itself does NOT make the sweep fit its own tick.
    const { reader } = fleetReader({
      count: 16,
      latencyMs: 300,
      statusOf: () => ({ currentFlowState: 'STATUS_FAILED' }),
    })

    const started = Date.now()
    const out = await collectPeerDBSignals(reader, {
      concurrency: 4,
      budgetMs: 400,
    })
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(1_000)
    // Truncated work is reported as deferred, never as an error.
    expect(out.metrics.budgetDeferred).toBeGreaterThan(0)
    expect(out.metrics.signalsCollected).toBe(16)
  })

  test('budget-truncated mirrors read the SUSPICIOUS mirrors first', async () => {
    // 20 mirrors, pool 2, tiny budget: only the first few statuses are read.
    // The mirror list marks m0..m3 as not-running, so those must be the ones
    // that got a status — a budget-truncated tick must still see the mirrors
    // most likely to fire.
    const names = Array.from({ length: 20 }, (_, i) => ({
      name: `m${i}`,
      sourceName: 'pg',
      status: i < 4 ? 'STATUS_FAILED' : 'STATUS_RUNNING',
    }))
    const readStatuses: string[] = []
    const reader = stubReader({
      listMirrors: async () => names,
      mirrorStatus: async (name) => {
        readStatuses.push(name)
        await sleep(60)
        return { currentFlowState: 'STATUS_RUNNING' }
      },
    })

    await collectPeerDBSignals(reader, { concurrency: 2, budgetMs: 150 })

    expect(readStatuses.length).toBeLessThan(20)
    expect(readStatuses.slice(0, 4).sort()).toEqual(['m0', 'm1', 'm2', 'm3'])
  })

  test('env PEERDB_SWEEP_CONCURRENCY is honoured and clamped', () => {
    const orig = process.env.PEERDB_SWEEP_CONCURRENCY
    try {
      delete process.env.PEERDB_SWEEP_CONCURRENCY
      expect(resolvePeerDBSweepConcurrency()).toBe(
        DEFAULT_PEERDB_SWEEP_CONCURRENCY
      )
      process.env.PEERDB_SWEEP_CONCURRENCY = '3'
      expect(resolvePeerDBSweepConcurrency()).toBe(3)
      process.env.PEERDB_SWEEP_CONCURRENCY = '0'
      expect(resolvePeerDBSweepConcurrency()).toBe(
        DEFAULT_PEERDB_SWEEP_CONCURRENCY
      )
      process.env.PEERDB_SWEEP_CONCURRENCY = 'abc'
      expect(resolvePeerDBSweepConcurrency()).toBe(
        DEFAULT_PEERDB_SWEEP_CONCURRENCY
      )
      // A typo must never be able to restore the unbounded fan-out.
      process.env.PEERDB_SWEEP_CONCURRENCY = '100000'
      expect(resolvePeerDBSweepConcurrency()).toBe(PEERDB_SWEEP_MAX_CONCURRENCY)
    } finally {
      if (orig === undefined) delete process.env.PEERDB_SWEEP_CONCURRENCY
      else process.env.PEERDB_SWEEP_CONCURRENCY = orig
    }
  })
})

describe('collectPeerDBSignals healthy-skip rule (#3677)', () => {
  test('a running mirror with no errorMessage issues NO logs call', async () => {
    const { reader, logsFor } = fleetReader({ count: 50 })

    const out = await collectPeerDBSignals(reader, { budgetMs: 10_000 })

    // Pre-fix this was 50 logs calls; on the reported 72-mirror fleet the whole
    // ERROR-log read is what saturated the catalog.
    expect(logsFor).toEqual([])
    expect(out.metrics.errorLogReads).toBe(0)
    expect(out.metrics.errorLogsSkipped).toBe(50)
  })

  test('skipped is not unavailable — a healthy mirror is not errored or held', async () => {
    const { reader } = fleetReader({ count: 3 })

    const out = await collectPeerDBSignals(reader, { budgetMs: 10_000 })

    expect(out.metrics.errored).toBe(0)
    for (const s of out.signals) {
      expect(s.errorCountSource).toBe('skipped')
      expect(s.statusEndpointAvailable).toBe(true)
    }
    // Classified ok, with the skip recorded but never as a failure.
    for (const s of out.signals) {
      const c = classifyPeerDBMirror(s)
      expect(c.severity).toBe('ok')
      expect(c.reasons).not.toContain('error-count-unavailable')
    }
  })

  test('logs ARE read for a non-running mirror', async () => {
    const { reader, logsFor } = fleetReader({
      count: 4,
      statusOf: (i) => ({
        currentFlowState: i === 2 ? 'STATUS_FAILED' : 'STATUS_RUNNING',
      }),
      countFromLogs: () => 9,
    })

    const out = await collectPeerDBSignals(reader, { budgetMs: 10_000 })

    expect(logsFor).toEqual(['m2'])
    expect(out.metrics.errorLogReads).toBe(1)
    expect(out.signals.find((s) => s.flowName === 'm2')!.recentErrorCount).toBe(
      9
    )
  })

  test('logs ARE read when a running mirror carries an errorMessage', async () => {
    const { reader, logsFor } = fleetReader({
      count: 3,
      statusOf: (i) => ({
        currentFlowState: 'STATUS_RUNNING',
        errorMessage: i === 1 ? 'wal reader crashed' : undefined,
      }),
    })

    await collectPeerDBSignals(reader, { budgetMs: 10_000 })

    expect(logsFor).toEqual(['m1'])
  })

  test('an unreadable status does NOT trigger a logs call (no second storm)', async () => {
    // Pre-fix, a status timeout was paired with an already-in-flight logs call.
    // When the catalog is saturated (the reported failure) that doubled the
    // load exactly when it hurt most.
    let logsCalls = 0
    const reader = stubReader({
      listMirrors: async () => [{ name: 'm' }],
      mirrorStatus: async () => null,
      mirrorErrorCount: async () => {
        logsCalls++
        return { count: 0, source: 'log-api' as const }
      },
    })

    const out = await collectPeerDBSignals(reader, { budgetMs: 10_000 })

    expect(logsCalls).toBe(0)
    expect(out.metrics.errored).toBe(1)
  })

  test('measured fleet shape: 72 mirrors -> 72 status calls, ~0 logs calls', async () => {
    // The reported deployment. One `logs` call costs 0.3s–14s there while
    // `status` alone answers 72 in 1.8s.
    const { reader, calls, logsFor } = fleetReader({ count: 72 })

    const out = await collectPeerDBSignals(reader, {
      concurrency: 8,
      budgetMs: 10_000,
    })

    // 72 reported, 50 collected: the pre-existing PEERDB_ALERT_MAX_MIRRORS cap
    // bounds it. The point is the logs column — pre-fix this issued one
    // `POST /v1/mirrors/logs` per collected mirror, i.e. 50 catalog scans per
    // 10-minute tick; now it issues none.
    expect(out.metrics.mirrorsChecked).toBe(PEERDB_ALERT_MAX_MIRRORS)
    expect(calls.status).toBe(PEERDB_ALERT_MAX_MIRRORS)
    expect(logsFor).toEqual([])
    expect(out.metrics.errored).toBe(0)
    expect(out.metrics.errorLogReads).toBe(0)
  })
})

describe('PeerDB fetch failure classification (#3677)', () => {
  test('a fetch-timeout AbortError is a timeout, not a connection failure', async () => {
    const origUrl = process.env.PEERDB_API_URL
    const origFetch = globalThis.fetch
    try {
      process.env.PEERDB_API_URL = 'http://flow-api:8113'
      globalThis.fetch = (async () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }) as typeof globalThis.fetch

      let thrown: unknown
      try {
        await peerdbFetch('/v1/abort-classify-check')
      } catch (e) {
        thrown = e
      }

      expect(thrown).toBeInstanceOf(PeerDBError)
      const err = thrown as PeerDBError
      // Pre-fix this reported status 502 with a "connection failed" log, which
      // sent operators hunting a network fault that did not exist.
      expect(err.kind).toBe('timeout')
      expect(err.message).toContain('timed out')
      expect(err.message).not.toContain('Failed to reach')
    } finally {
      globalThis.fetch = origFetch
      if (origUrl === undefined) delete process.env.PEERDB_API_URL
      else process.env.PEERDB_API_URL = origUrl
    }
  })

  test('classifyPeerDBFetchFailure separates timeout / abort / auth / refused', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    })
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
    })

    // Timeout and abort are distinguished by WHO aborted.
    expect(classifyPeerDBFetchFailure(abort)).toBe('timeout')
    expect(classifyPeerDBFetchFailure(abort, { callerAborted: true })).toBe(
      'aborted'
    )
    expect(classifyPeerDBFetchFailure(refused)).toBe('refused')
    expect(classifyPeerDBFetchFailure(dns)).toBe('dns')
    expect(classifyPeerDBFetchFailure(new PeerDBError('x', 401, 'auth'))).toBe(
      'auth'
    )
    expect(
      classifyPeerDBFetchFailure(new PeerDBError('x', 503, 'unconfigured'))
    ).toBe('unconfigured')
  })

  test('every failure kind has a distinct label', () => {
    const kinds: PeerDBFetchFailure[] = [
      'unconfigured',
      'timeout',
      'aborted',
      'auth',
      'refused',
      'dns',
      'tls',
      'network',
      'upstream',
    ]
    const labels = kinds.map(peerDBFailureLabel)
    expect(new Set(labels).size).toBe(kinds.length)
    // A timeout must not read as a connectivity failure.
    expect(peerDBFailureLabel('timeout')).toContain('timed out')
    expect(peerDBFailureLabel('timeout')).not.toContain('unreachable')
  })

  test('describePeerDBFailure lifts name/message/cause.code out of the Error', () => {
    // `cause` is non-enumerable in a real `fetch` failure, exactly as in the
    // reported `"err":{}` log line.
    const inner = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    })
    const refused = new TypeError('fetch failed')
    Object.defineProperty(refused, 'cause', {
      value: inner,
      enumerable: false,
    })
    // The reported bug: `JSON.stringify(new Error(...))` is `{}` — the name,
    // the message and the cause code all vanish.
    expect(JSON.stringify(refused)).toBe('{}')
    const described = describePeerDBFailure(refused)
    expect(described.errName).toBe('TypeError')
    expect(described.errMessage).toBe('fetch failed')
    expect(described.causeCode).toBe('ECONNREFUSED')
  })

  test('the timeout log line names the failure instead of "connection failed"', async () => {
    const origUrl = process.env.PEERDB_API_URL
    const origFetch = globalThis.fetch
    const lines: string[] = []
    const origConsoleError = console.error
    try {
      process.env.PEERDB_API_URL = 'http://flow-api:8113'
      console.error = (...args: unknown[]) => {
        lines.push(String(args[0]))
      }
      globalThis.fetch = (async () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }) as typeof globalThis.fetch

      await peerdbFetch('/v1/log-line-check').catch(() => {})

      const emitted = lines.find((l) => l.includes('[PeerDB]')) ?? ''
      expect(emitted).not.toContain('connection failed')
      expect(emitted).toContain('timed out')
      // The cause fields that used to serialise to `"err":{}` are present.
      expect(emitted).toContain('AbortError')
      expect(emitted).toContain('kind')
    } finally {
      console.error = origConsoleError
      globalThis.fetch = origFetch
      if (origUrl === undefined) delete process.env.PEERDB_API_URL
      else process.env.PEERDB_API_URL = origUrl
    }
  })
})

describe('mapWithPool', () => {
  test('preserves order and reports aborted items', async () => {
    const controller = new AbortController()
    const out = await mapWithPool(
      [1, 2, 3, 4],
      2,
      async (n) => {
        if (n === 1) controller.abort()
        return n * 10
      },
      controller.signal
    )
    const done = out.filter((o) => o.kind === 'done')
    expect(done.map((o) => (o.kind === 'done' ? o.value : null))).toContain(10)
    expect(out.some((o) => o.kind === 'aborted')).toBe(true)
  })

  test('an empty input is a no-op', async () => {
    expect(await mapWithPool([], 4, async () => 1)).toEqual([])
  })
})

describe('defaultReader via mocked peerdbFetch', () => {
  const URL = 'http://flow-api:8113'
  let origUrl: string | undefined
  let origPassword: string | undefined
  let origScheme: string | undefined
  let origFetch: typeof globalThis.fetch

  const responses: Record<string, unknown> = {
    '/v1/mirrors/list': {
      mirrors: [{ name: 'alert-cycle-e2e', sourceName: 'pg-src' }],
    },
    '/v1/peers/list': { sourceItems: [{ name: 'pg-src' }] },
  }

  afterEach(() => {
    globalThis.fetch = origFetch
    if (origUrl === undefined) delete process.env.PEERDB_API_URL
    else process.env.PEERDB_API_URL = origUrl
    if (origPassword === undefined) delete process.env.PEERDB_PASSWORD
    else process.env.PEERDB_PASSWORD = origPassword
    if (origScheme === undefined) delete process.env.PEERDB_AUTH_SCHEME
    else process.env.PEERDB_AUTH_SCHEME = origScheme
  })

  test('reads status, shared-contract logs envelope, and slots', async () => {
    origUrl = process.env.PEERDB_API_URL
    origPassword = process.env.PEERDB_PASSWORD
    origScheme = process.env.PEERDB_AUTH_SCHEME
    origFetch = globalThis.fetch
    process.env.PEERDB_API_URL = URL
    process.env.PEERDB_PASSWORD = 'alert-token'
    process.env.PEERDB_AUTH_SCHEME = 'bearer'
    const seenAuth: string[] = []
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      seenAuth.push(headers.Authorization ?? '')
      const url = String(input)
      const path = url.slice(URL.length)
      if (path === '/v1/mirrors/status') {
        // Not running, so the ERROR-log read below is issued (#3677 skip rule).
        return new Response(
          JSON.stringify({
            currentFlowState: 'STATUS_FAILED',
            lagSec: 61,
          }),
          { status: 200 }
        )
      }
      if (path === '/v1/mirrors/logs') {
        // Error-lane envelope alias `{logs}` + mixed levels: only ERROR counts.
        // The shared mirror-logs contract owns casing/aliases (#3409).
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >
        expect(body.level).toBe('ERROR')
        return new Response(
          JSON.stringify({
            logs: [
              { message: 'wal reader crashed', level: 'ERROR' },
              { message: 'all good', level: 'INFO' },
            ],
          }),
          { status: 200 }
        )
      }
      if (path === '/v1/peers/slots/pg-src') {
        return new Response(JSON.stringify({ slotData: [{ lagInMb: 7 }] }), {
          status: 200,
        })
      }
      const hit = responses[path]
      if (hit !== undefined) {
        return new Response(JSON.stringify(hit), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    // Reach the default reader by omitting the injected reader.
    const out = await collectPeerDBSignals(undefined)
    expect(out.signals).toHaveLength(1)
    const s = out.signals[0]!
    expect(s.flowName).toBe('alert-cycle-e2e')
    expect(s.lagSec).toBe(61)
    expect(s.recentErrorCount).toBe(1)
    expect(s.errorCountSource).toBe('log-api')
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(seenAuth.every((auth) => auth === 'Bearer alert-token')).toBe(true)
    expect(s.slotLagMb).toBe(7)
  })
})
