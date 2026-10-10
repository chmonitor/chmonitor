/**
 * Read-only PeerDB alert collector.
 *
 * Builds the `PeerDBMirrorSignal[]` the alert cycle classifies: mirror list,
 * per-mirror status, recent error volume, and slot lag mapped via each
 * mirror's `sourceName`. All reads use the fixed allowlisted `GET/POST /v1/*`
 * paths through `peerdbFetch` — never a mutating PeerDB operation.
 *
 * Log casing/envelope handling is NOT duplicated here: request bodies go
 * through `mirrorLogsRequestBody` (uppercase `level`, strict-PeerDB-safe) and
 * responses through `extractMirrorLogs`/`countMirrorLogLevels` from the shared
 * `lib/peerdb/mirror-logs` contract (#3406/#3409).
 *
 * The {@link PeerDBAlertSnapshotReader} interface is intentionally a
 * structural sibling of the metrics/insights lane's `PeerDBSnapshotReader`
 * (its `mirrorErrorCount` returns a bare number where this one returns
 * `{count, source}` so the alert lane can distinguish "0 errors" from
 * "count unavailable" — adapt with
 * `async (n) => ({ count: await r.mirrorErrorCount(n), source: 'log-api' })`).
 * Per-connection (`?connection=<id>`) reads are out of v1: this covers the
 * env-wide deployment only.
 *
 * Collectors NEVER throw — unconfigured PeerDB, an unreachable flow-api, or a
 * single failed upstream call yields an empty/partial result so the health
 * sweep around the alert cycle degrades gracefully.
 *
 * Coverage is reported, never assumed (#3687): every collection returns
 * `metrics.mirrorsListed` alongside `metrics.mirrorsChecked` plus an explicit
 * `partial` / `unchecked` pair (see `./sweep-coverage`), so a tick that could
 * not read the whole fleet says so instead of looking like a clean bill of
 * health.
 */

import type {
  PeerDBErrorCountSource,
  PeerDBInvestigationMetrics,
  PeerDBMirrorSignal,
} from './alerting'
import type { PeerDBFetchFailure } from './peerdb-config'
import type { PeerDBSweepCoverage } from './sweep-coverage'
import type {
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorListItem,
  MirrorStatusResponse,
  PeerSlotResponse,
  SlotInfo,
} from './types'

import {
  earliestCloneStartMs,
  PEERDB_SNAPSHOT_STALL_MS,
} from '../insights/peerdb-checks'
import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
} from './mirror-logs'
import { summarizeSweepCoverage } from './sweep-coverage'
import {
  mapWithPool,
  resolvePeerDBSweepBudgetMs,
  resolvePeerDBSweepConcurrency,
  resolvePeerDBSweepMaxMirrors,
  startSweepBudget,
} from './sweep-pool'

/**
 * Read-only PeerDB snapshot source. The default implementation talks to the
 * env-configured flow-api via `peerdbFetch`; tests (and the Workers runtime,
 * whose proxy path resolves config from bindings) inject a stub. Every method
 * is expected to be best-effort — implementations should return `null`/`[]`
 * on failure rather than throw, and collection defends with `.catch`
 * regardless.
 */
export interface PeerDBAlertSnapshotReader {
  /**
   * `GET /v1/mirrors/list`. The ONE method allowed to throw: a throw means the
   * list call failed (unreachable / auth failed / upstream error), which the
   * collection reports as `listFailure` — distinct from a fleet of zero
   * mirrors, which resolves to `[]` (#3675).
   */
  listMirrors(): Promise<MirrorListItem[]>
  /** Per-mirror `POST /v1/mirrors/status` payload, or null when unreadable. */
  mirrorStatus(name: string): Promise<MirrorStatusResponse | null>
  /**
   * Recent ERROR-level log volume for a mirror. `source: 'unavailable'` when
   * the logs call itself failed (so the classifier renders "error count
   * unavailable", never "0 errors").
   */
  mirrorErrorCount(name: string): Promise<{
    count: number
    source: PeerDBErrorCountSource
  }>
  /** Replication slots per source peer name. */
  peerSlots(peer: string): Promise<SlotInfo[]>
  /** Source peer names (from `GET /v1/peers/list`). */
  listSourcePeers(): Promise<string[]>
}

/**
 * Whether a mirror is worth the expensive per-mirror ERROR-log read (#3677).
 *
 * `POST /v1/mirrors/logs` filtered to `level=ERROR` is by far the most
 * expensive read in this lane: PeerDB's only index on `flow_errors` is
 * `flow_name`, so the `error_type` filter scans every row for that mirror. On
 * a fleet whose `flow_errors` is 99.97% `info` QRep noise (2.88M rows across 72
 * mirrors) that read costs seconds and returns nothing.
 *
 * So it is issued only for a mirror that already looks wrong:
 *   - `STATUS_RUNNING` + no `errorMessage` → skip (the common, healthy case);
 *   - any other readable state (`FAILED`, `PAUSED`, `UNKNOWN`, …) → read;
 *   - `errorMessage` present → read;
 *   - status unreadable / no usable state → do NOT read. The mirror is already
 *     counted errored, and a status timeout means PeerDB is saturated — adding
 *     a second expensive call per mirror there is exactly the storm this change
 *     removes. The next tick retries it.
 *
 * A skipped read is reported as `errorCountSource: 'skipped'`, deliberately
 * distinct from `'unavailable'`: nothing failed, so it must not inflate
 * `errored`, must not hold a recovery in the cycle, and must not be phrased as
 * "error count unavailable" in an alert message.
 */
export function isErrorLogWorthy(
  status: MirrorStatusResponse | null | undefined
): boolean {
  if (!status) return false
  if (typeof status.currentFlowState !== 'string') return false
  if ((status.errorMessage ?? '').trim() !== '') return true
  return status.currentFlowState !== 'STATUS_RUNNING'
}

/**
 * Clamp a caller/env-supplied mirror guard (#3687). Anything below 1 resolves
 * to `null` — no guard — rather than to a fleet of zero: a guard that reads
 * nothing must never look like a complete tick. `resolvePeerDBSweepMaxMirrors`
 * already applies this to the env value; this repeats it for an injected
 * option, which is how tests and any future caller pass the guard directly.
 */
function normalizeMirrorGuard(value: number | null): number | null {
  if (value === null) return null
  return Number.isFinite(value) && Math.floor(value) >= 1
    ? Math.floor(value)
    : null
}

/**
 * Work order for the status stage: mirrors the mirror-list already reports as
 * NOT running go first, so when the wall-clock budget cuts the run short the
 * mirrors most likely to fire are the ones that were read (#3677). Signal
 * OUTPUT order is unaffected — it still follows the mirror list.
 */
function prioritiseSuspectMirrors(mirrors: MirrorListItem[]): MirrorListItem[] {
  return [
    ...mirrors.filter((m) => m.status !== 'STATUS_RUNNING'),
    ...mirrors.filter((m) => m.status === 'STATUS_RUNNING'),
  ]
}

/**
 * Map a thrown list-call error onto the shared fetch-failure taxonomy. The
 * classifier lives in `peerdb-config`, imported dynamically for the same
 * runtime reason as {@link defaultReader}; without it the failure is still
 * reported, as `network`.
 */
async function classifyListFailure(err: unknown): Promise<PeerDBListFailure> {
  const mod = await import('./peerdb-config').catch(() => null)
  let kind: PeerDBFetchFailure = 'network'
  try {
    if (mod) kind = mod.classifyPeerDBFetchFailure(err)
  } catch {
    // keep `network`
  }
  // An explicit 503 "unconfigured" from a configured deployment is still a
  // failed call from the sweep's point of view — report it as upstream.
  if (kind === 'unconfigured') kind = 'upstream'
  const label = mod ? mod.peerDBFailureLabel(kind) : 'network unreachable'
  return { kind, label }
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Default env-configured reader. Gate: returns null reads when
 * `PEERDB_API_URL` is unset. The `peerdb-config` import is dynamic so a
 * runtime without node built-ins degrades to empty reads instead of failing
 * module evaluation (same pattern as the insights lane's collector).
 *
 * `signal` is the collection's wall-clock budget: forwarding it to
 * `peerdbFetch` lets the budget cancel in-flight calls instead of only
 * refusing to start new ones.
 */
async function defaultReader(
  signal?: AbortSignal
): Promise<PeerDBAlertSnapshotReader | null> {
  const mod = await import('./peerdb-config').catch(() => null)
  const getConfig = mod?.getPeerDBConfig as
    | (() => { baseUrl: string } | null)
    | undefined
  const fetchFn = mod?.peerdbFetch as
    | (<T>(path: string, init?: RequestInit) => Promise<T>)
    | undefined
  // Unconfigured → no reader at all, so the collection reports
  // `configured: false` instead of a listing that merely came back empty.
  if (!getConfig || !fetchFn) return null
  let configured = false
  try {
    configured = getConfig() !== null
  } catch {
    return null
  }
  if (!configured) return null

  const fetchOptions = (body: string): RequestInit =>
    signal ? { method: 'POST', body, signal } : { method: 'POST', body }

  return {
    // Deliberately NOT wrapped in `safe`: a failed list call must reach the
    // collection as a failure, not as an empty fleet (#3675).
    listMirrors: async () => {
      const res = await fetchFn<ListMirrorsResponse>('/v1/mirrors/list')
      return Array.isArray(res?.mirrors) ? res.mirrors : []
    },
    mirrorStatus: (name) =>
      safe(
        () =>
          fetchFn<MirrorStatusResponse>(
            '/v1/mirrors/status',
            fetchOptions(JSON.stringify({ flow_job_name: name }))
          ),
        null
      ),
    mirrorErrorCount: (name) =>
      safe(
        async () => {
          const res = await fetchFn<unknown>(
            '/v1/mirrors/logs',
            // Shared contract (#3409): uppercase ERROR level — strict PeerDB
            // returns zero rows for lowercase — bounded page.
            fetchOptions(
              JSON.stringify(
                mirrorLogsRequestBody(name, 'error', { numPerPage: 100 })
              )
            )
          )
          if (res === null || res === undefined) {
            return { count: 0, source: 'unavailable' as const }
          }
          const count = countMirrorLogLevels(extractMirrorLogs(res)).error
          return { count, source: 'log-api' as const }
        },
        { count: 0, source: 'unavailable' as const }
      ),
    peerSlots: (peer) =>
      safe(async () => {
        const res = await fetchFn<PeerSlotResponse>(
          `/v1/peers/slots/${encodeURIComponent(peer)}`
        )
        return Array.isArray(res?.slotData) ? res.slotData : []
      }, []),
    listSourcePeers: () =>
      safe(async () => {
        const res = await fetchFn<ListPeersResponse>('/v1/peers/list')
        const names = [
          ...(res?.sourceItems ?? []).map((p) => p?.name),
          ...(res?.items ?? []).map((p) => p?.name),
        ]
        return [...new Set(names.filter((n) => typeof n === 'string' && n))]
      }, []),
  }
}

/**
 * Why `GET /v1/mirrors/list` failed this tick (#3675). `kind` reuses the
 * fetch-failure taxonomy from `peerdb-config`; `label` is its human text.
 */
export interface PeerDBListFailure {
  kind: PeerDBFetchFailure
  label: string
}

export interface PeerDBSignalCollection {
  /**
   * False when PeerDB is not configured (no reader): the only case the cycle
   * may treat as a no-op. A configured deployment always reports `true`.
   */
  configured: boolean
  /**
   * Non-null when the mirror list call itself failed — PeerDB unreachable,
   * auth failed, or an upstream error. Null with zero signals means PeerDB
   * answered with an empty fleet, which is NOT a failure (#3675).
   */
  listFailure: PeerDBListFailure | null
  signals: PeerDBMirrorSignal[]
  /** Collection stats feeding the deterministic investigation step. */
  metrics: PeerDBInvestigationMetrics & {
    /**
     * Mirrors PeerDB listed this tick (`GET /v1/mirrors/list`), before any
     * bound — the size of the fleet this collection was asked to cover.
     */
    mirrorsListed: number
    /**
     * Mirrors this tick actually read a status for. A read that FAILED still
     * counts (see `errored`); a mirror the budget or the guard skipped does not
     * (#3687). Always `<= mirrorsListed`.
     */
    mirrorsChecked: number
    /**
     * `mirrorsListed > mirrorsChecked`: at least one mirror produced NO signal
     * this tick. The load-bearing flag — a caller that reports a green result
     * without it is reporting over a fleet it never looked at (#3687).
     */
    partial: boolean
    /** `mirrorsListed - mirrorsChecked` — mirrors with no signal at all. */
    unchecked: number
    /** Mirrors missing a usable status state or error-log sample. */
    errored: number
    /**
     * Mirrors the wall-clock budget left uncollected this tick (#3677). Not an
     * error — an explicit "we ran out of time" signal, so an operator can tell
     * a deferred tick from a broken PeerDB.
     */
    budgetDeferred: number
    /** `POST /v1/mirrors/logs` calls actually issued. */
    errorLogReads: number
    /** Healthy mirrors whose ERROR-log read was skipped by design. */
    errorLogsSkipped: number
  }
  /** Worst slot lag observed fleet-wide, MiB (null when unknown). */
  fleetMaxSlotLagMb: number | null
}

/** Per-call bounds for the fan-out; both default from the env (#3677). */
export interface PeerDBSignalCollectionOptions {
  /** Max in-flight per-mirror reads (default `PEERDB_SWEEP_CONCURRENCY`). */
  concurrency?: number
  /** Wall-clock budget for the whole collection (default `PEERDB_SWEEP_BUDGET_MS`). */
  budgetMs?: number
  /**
   * Optional guard on how many mirrors to read (default
   * `PEERDB_SWEEP_MAX_MIRRORS`); `null` explicitly means no guard.
   *
   * This replaced the hardcoded 50-mirror cap, which was not a performance
   * control (#3677 removed the problem it stood in for) and silently dropped
   * every mirror past 50 — a failure at position 60 produced no alert and no
   * signal of any kind (#3687). Any truncation it does cause is reported
   * through `metrics.partial` / `metrics.unchecked`.
   */
  maxMirrors?: number | null
}

/**
 * Collect one `PeerDBMirrorSignal` per mirror. Never throws — total failure
 * yields zero signals (the cycle then no-ops, including recoveries it cannot
 * observe; the persistent alert state is left untouched).
 *
 * Fan-out shape (#3677), in three pool-bounded stages:
 *
 *   1. `POST /v1/mirrors/status` per mirror (cheap; ~1.8s for 72 in parallel).
 *   2. `POST /v1/mirrors/logs` — ONLY for mirrors stage 1 flagged suspicious
 *      (see {@link isErrorLogWorthy}). Healthy running mirrors cost no logs
 *      read at all.
 *   3. `GET /v1/peers/slots/<peer>` per source peer.
 *
 * Concurrency is bounded by `PEERDB_SWEEP_CONCURRENCY` (default 8) so the
 * sweep never floods the PeerDB catalog, and the whole collection is bounded by
 * `PEERDB_SWEEP_BUDGET_MS` (default 60s) so a pool cannot simply turn 144
 * parallel timeouts into 90s of sequential ones. Work is ordered
 * suspects-first so a budget-truncated tick still reads the mirrors most likely
 * to fire.
 *
 * Those two bounds decide how MUCH is read; nothing decides WHICH mirrors may
 * be skipped. The old 50-mirror cap is gone (#3687) — every listed mirror is
 * in scope unless the operator sets `PEERDB_SWEEP_MAX_MIRRORS` — and whenever
 * fewer mirrors were read than listed, `metrics.partial` says so with the exact
 * shortfall. There is no configuration of this lane that drops a mirror
 * silently.
 */
export async function collectPeerDBSignals(
  reader?: PeerDBAlertSnapshotReader,
  opts?: PeerDBSignalCollectionOptions
): Promise<PeerDBSignalCollection> {
  const budgetMs = opts?.budgetMs ?? resolvePeerDBSweepBudgetMs()
  const budget = startSweepBudget(budgetMs)
  const empty = (
    coverage: PeerDBSweepCoverage = summarizeSweepCoverage(0, 0),
    extra: { configured: boolean; listFailure: PeerDBListFailure | null } = {
      configured: true,
      listFailure: null,
    }
  ): PeerDBSignalCollection => ({
    ...extra,
    signals: [],
    metrics: {
      signalsCollected: 0,
      hasLagSample: false,
      hasErrorSample: false,
      hasSlotSample: false,
      mirrorsListed: coverage.listed,
      mirrorsChecked: coverage.checked,
      partial: coverage.partial,
      unchecked: coverage.unchecked,
      errored: 0,
      budgetDeferred: 0,
      errorLogReads: 0,
      errorLogsSkipped: 0,
    },
    fleetMaxSlotLagMb: null,
  })
  try {
    const r = reader ?? (await defaultReader(budget.signal).catch(() => null))
    if (!r) {
      return empty(undefined, { configured: false, listFailure: null })
    }

    const concurrency = opts?.concurrency ?? resolvePeerDBSweepConcurrency()

    let mirrors: MirrorListItem[]
    try {
      const listed = await r.listMirrors()
      mirrors = Array.isArray(listed) ? listed : []
    } catch (err) {
      return empty(undefined, {
        configured: true,
        listFailure: await classifyListFailure(err),
      })
    }
    const named = mirrors.filter(
      (m) => typeof m?.name === 'string' && m.name.trim() !== ''
    )
    // The fleet this tick is responsible for, before any bound. `listed` is the
    // raw list length so an entry PeerDB returns that we cannot even name still
    // counts as unchecked — it is a mirror with no signal.
    const maxMirrors = normalizeMirrorGuard(
      opts?.maxMirrors ?? resolvePeerDBSweepMaxMirrors()
    )
    const scoped = maxMirrors === null ? named : named.slice(0, maxMirrors)
    if (scoped.length === 0) {
      // Nothing readable in the list. Still answer the coverage question
      // honestly: a listing we could not read is not a clean tick.
      return empty(summarizeSweepCoverage(mirrors.length, 0))
    }

    // Stage 1 — per-mirror status, pool-bounded and suspects-first. One
    // mirror's failure never blocks the rest.
    const statusOrder = prioritiseSuspectMirrors(scoped)
    const statusOutcomes = await mapWithPool(
      statusOrder,
      concurrency,
      (m) => safe(() => r.mirrorStatus(m.name), null),
      budget.signal
    )
    const statuses = new Map<string, MirrorStatusResponse | null>()
    const statusDeferred = new Set<string>()
    // Counted from the outcomes, not from `statusDeferred.size`: two list
    // entries can share a name, and the coverage answer must not drift when
    // they do (#3687).
    let statusRead = 0
    statusOutcomes.forEach((outcome, i) => {
      const name = statusOrder[i]!.name
      if (outcome.kind === 'done') {
        statusRead++
        statuses.set(name, outcome.value)
      } else {
        statuses.set(name, null)
        statusDeferred.add(name)
      }
    })

    // Stage 2 — ERROR-log reads, only where stage 1 says the mirror is
    // suspicious. This is the expensive call, so it is also the one skipped
    // whenever there is no positive evidence of a problem.
    const logTargets = scoped.filter((m) =>
      isErrorLogWorthy(statuses.get(m.name))
    )
    const logOutcomes = await mapWithPool(
      logTargets,
      concurrency,
      (m) =>
        safe(() => r.mirrorErrorCount(m.name), {
          count: 0,
          source: 'unavailable' as const,
        }),
      budget.signal
    )
    const errorCounts = new Map<
      string,
      { count: number; source: PeerDBErrorCountSource }
    >()
    const logsDeferred = new Set<string>()
    logOutcomes.forEach((outcome, i) => {
      const name = logTargets[i]!.name
      if (outcome.kind === 'done') {
        errorCounts.set(name, outcome.value)
      } else {
        errorCounts.set(name, { count: 0, source: 'skipped' })
        logsDeferred.add(name)
      }
    })

    // Slots across source peers → worst lag per mirror via `sourceName`.
    // No cap here: a slot read is one cheap GET per peer, the pool and budget
    // already bound it, and a peer the budget defers yields an empty slot list
    // → `slotLagMb: null` (reported as unknown, never as a healthy zero).
    const peers = await safe(() => r.listSourcePeers(), [])
    const slotOutcomes = await mapWithPool(
      peers,
      concurrency,
      (peer) => safe(() => r.peerSlots(peer), [] as SlotInfo[]),
      budget.signal
    )
    const slotsByPeer = new Map<string, SlotInfo[]>()
    slotOutcomes.forEach((outcome, i) => {
      slotsByPeer.set(peers[i]!, outcome.kind === 'done' ? outcome.value : [])
    })

    // Per-mirror accounting. `errored` counts only mirrors this tick actually
    // read AND failed to read: a healthy-skip is not a failure, and neither is
    // a mirror the budget never reached — counting the latter here is what made
    // a time-limited tick read as a fleet of broken mirrors (#3677), and it
    // would contradict `mirrorsChecked` now that skipped mirrors are excluded
    // from that count (#3687).
    let errored = 0
    let errorLogsSkipped = 0
    for (const m of scoped) {
      if (statusDeferred.has(m.name)) continue
      const st = statuses.get(m.name) ?? null
      if (st === null) errored++
      if (!isErrorLogWorthy(st)) {
        errorLogsSkipped++
        continue
      }
      if (errorCounts.get(m.name)?.source === 'unavailable') errored++
    }
    const budgetDeferred = statusDeferred.size + logsDeferred.size
    const worstSlotLag = (slots: SlotInfo[]): number | null => {
      let worst: number | null = null
      for (const s of slots) {
        const lag = toNum(s?.lagInMb)
        if (lag === null) continue
        if (worst === null || lag > worst) worst = lag
      }
      return worst
    }
    let fleetMaxSlotLagMb: number | null = null
    const slotLagByMirror = new Map<string, number | null>()
    for (const m of scoped) {
      const lag = m.sourceName
        ? worstSlotLag(slotsByPeer.get(m.sourceName) ?? [])
        : null
      slotLagByMirror.set(m.name, lag)
      if (
        lag !== null &&
        (fleetMaxSlotLagMb === null || lag > fleetMaxSlotLagMb)
      ) {
        fleetMaxSlotLagMb = lag
      }
    }

    const signals: PeerDBMirrorSignal[] = scoped.map((m) => {
      const st = statuses.get(m.name) ?? null
      // Default `skipped`, never `unavailable`: a mirror we deliberately did
      // not read has no error sample, but it is NOT a failed read.
      const ec = errorCounts.get(m.name) ?? {
        count: 0,
        source: 'skipped' as const,
      }
      const clones = st?.cdcStatus?.snapshotStatus?.clones
      // In-progress is not an alert: stalled only once the earliest clone has
      // been running for PEERDB_SNAPSHOT_STALL_MS. Unknown start = not stalled.
      const startedAtMs = Array.isArray(clones)
        ? earliestCloneStartMs(clones)
        : null
      const snapshotStalled =
        Array.isArray(clones) &&
        clones.length > 0 &&
        clones.filter((c) => c?.fetchCompleted && c?.consolidateCompleted)
          .length < clones.length &&
        startedAtMs !== null &&
        Date.now() - startedAtMs >= PEERDB_SNAPSHOT_STALL_MS
      return {
        flowName: m.name,
        status: st?.currentFlowState ?? m.status ?? null,
        statusEndpointAvailable: typeof st?.currentFlowState === 'string',
        errorMessage: st?.errorMessage ?? null,
        lagSec: toNum(st?.lagSec),
        rowsSynced: toNum(
          (st?.cdcStatus?.rowsSynced as number | string | undefined) ??
            (st as { totalRowsSynced?: unknown } | undefined)?.totalRowsSynced
        ),
        lastSyncedAtMs: Array.isArray(st?.cdcStatus?.cdcBatches)
          ? latestBatchEndMs(st.cdcStatus.cdcBatches)
          : null,
        recentErrorCount: ec.count,
        errorCountSource: ec.source,
        slotLagMb: slotLagByMirror.get(m.name) ?? null,
        snapshotStalled,
      }
    })

    const hasLagSample = signals.some((s) => s.lagSec !== null)
    const hasErrorSample = signals.some((s) => s.errorCountSource === 'log-api')
    const hasSlotSample = signals.some((s) => s.slotLagMb !== null)

    // One coverage object, four reported facts (#3687). `checked` is what this
    // tick actually read, so both the old 50-mirror truncation and a
    // budget-truncated tick surface here as `partial`.
    const coverage = summarizeSweepCoverage(mirrors.length, statusRead)

    return {
      configured: true,
      listFailure: null,
      signals,
      metrics: {
        signalsCollected: signals.length,
        hasLagSample,
        hasErrorSample,
        hasSlotSample,
        mirrorsListed: coverage.listed,
        mirrorsChecked: coverage.checked,
        partial: coverage.partial,
        unchecked: coverage.unchecked,
        errored,
        budgetDeferred,
        errorLogReads: logTargets.length,
        errorLogsSkipped,
      },
      fleetMaxSlotLagMb,
    }
  } catch {
    return empty()
  } finally {
    budget.dispose()
  }
}

/**
 * Epoch ms of the most recent CDC batch `endTime` in a status payload, or null
 * when no batch reports a parseable one. Accepts ISO strings and numeric epoch
 * seconds/ms (values below 1e11 are seconds), matching the mirror detail page.
 */
export function latestBatchEndMs(
  batches: ReadonlyArray<{ endTime?: string | number | null } | null>
): number | null {
  let latest: number | null = null
  for (const b of batches) {
    const raw = b?.endTime
    if (raw == null || raw === '') continue
    const n =
      typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : Number.NaN
    const ms = Number.isFinite(n)
      ? n < 1e11
        ? n * 1000
        : n
      : Date.parse(String(raw))
    if (Number.isFinite(ms) && (latest === null || ms > latest)) latest = ms
  }
  return latest
}
