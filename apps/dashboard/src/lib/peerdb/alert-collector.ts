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
 */

import type {
  PeerDBErrorCountSource,
  PeerDBInvestigationMetrics,
  PeerDBMirrorSignal,
} from './alerting'
import type {
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorListItem,
  MirrorStatusResponse,
  PeerSlotResponse,
  SlotInfo,
} from './types'

import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
} from './mirror-logs'

/**
 * Read-only PeerDB snapshot source. The default implementation talks to the
 * env-configured flow-api via `peerdbFetch`; tests (and the Workers runtime,
 * whose proxy path resolves config from bindings) inject a stub. Every method
 * is expected to be best-effort — implementations should return `null`/`[]`
 * on failure rather than throw, and collection defends with `.catch`
 * regardless.
 */
export interface PeerDBAlertSnapshotReader {
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

/** Maximum mirrors to fan out per-mirror status/logs reads to. */
export const PEERDB_ALERT_MAX_MIRRORS = 50

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
 */
async function defaultReader(): Promise<PeerDBAlertSnapshotReader> {
  const mod = await import('./peerdb-config').catch(() => null)
  const getConfig = mod?.getPeerDBConfig as
    | (() => { baseUrl: string } | null)
    | undefined
  const fetchFn = mod?.peerdbFetch as
    | (<T>(path: string, init?: RequestInit) => Promise<T>)
    | undefined
  const unconfigured: PeerDBAlertSnapshotReader = {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => ({ count: 0, source: 'unavailable' }),
    peerSlots: async () => [],
    listSourcePeers: async () => [],
  }
  if (!getConfig || !fetchFn) return unconfigured
  let configured = false
  try {
    configured = getConfig() !== null
  } catch {
    return unconfigured
  }
  if (!configured) return unconfigured

  return {
    listMirrors: () =>
      safe(async () => {
        const res = await fetchFn<ListMirrorsResponse>('/v1/mirrors/list')
        return Array.isArray(res?.mirrors) ? res.mirrors : []
      }, []),
    mirrorStatus: (name) =>
      safe(
        () =>
          fetchFn<MirrorStatusResponse>('/v1/mirrors/status', {
            method: 'POST',
            body: JSON.stringify({ flow_job_name: name }),
          }),
        null
      ),
    mirrorErrorCount: (name) =>
      safe(
        async () => {
          const res = await fetchFn<unknown>('/v1/mirrors/logs', {
            method: 'POST',
            // Shared contract (#3409): uppercase ERROR level — strict PeerDB
            // returns zero rows for lowercase — bounded page.
            body: JSON.stringify(
              mirrorLogsRequestBody(name, 'error', { numPerPage: 100 })
            ),
          })
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

export interface PeerDBSignalCollection {
  signals: PeerDBMirrorSignal[]
  /** Collection stats feeding the deterministic investigation step. */
  metrics: PeerDBInvestigationMetrics & {
    mirrorsChecked: number
    /** Mirrors missing a usable status state or error-log sample. */
    errored: number
  }
  /** Worst slot lag observed fleet-wide, MiB (null when unknown). */
  fleetMaxSlotLagMb: number | null
}

/**
 * Collect one `PeerDBMirrorSignal` per mirror. Never throws — total failure
 * yields zero signals (the cycle then no-ops, including recoveries it cannot
 * observe; the persistent alert state is left untouched).
 */
export async function collectPeerDBSignals(
  reader?: PeerDBAlertSnapshotReader
): Promise<PeerDBSignalCollection> {
  const empty = (): PeerDBSignalCollection => ({
    signals: [],
    metrics: {
      signalsCollected: 0,
      hasLagSample: false,
      hasErrorSample: false,
      hasSlotSample: false,
      mirrorsChecked: 0,
      errored: 0,
    },
    fleetMaxSlotLagMb: null,
  })
  try {
    const r = reader ?? (await defaultReader().catch(() => null))
    if (!r) return empty()

    const mirrors = await safe(() => r.listMirrors(), [])
    const scoped = mirrors
      .filter((m) => typeof m?.name === 'string' && m.name.trim() !== '')
      .slice(0, PEERDB_ALERT_MAX_MIRRORS)
    if (scoped.length === 0) return empty()

    // Per-mirror status + error volume, fetched concurrently; one mirror's
    // failure never blocks the rest.
    let errored = 0
    const statuses = new Map<string, MirrorStatusResponse>()
    const errorCounts = new Map<
      string,
      { count: number; source: PeerDBErrorCountSource }
    >()
    await Promise.all(
      scoped.map(async (m) => {
        const name = m.name
        const [st, ec] = await Promise.all([
          safe(() => r.mirrorStatus(name), null),
          safe(() => r.mirrorErrorCount(name), {
            count: 0,
            source: 'unavailable' as const,
          }),
        ])
        if (st) statuses.set(name, st)
        errorCounts.set(name, ec)
        if (
          typeof st?.currentFlowState !== 'string' ||
          ec.source === 'unavailable'
        ) {
          errored++
        }
      })
    )

    // Slots across source peers → worst lag per mirror via `sourceName`.
    const peers = await safe(() => r.listSourcePeers(), [])
    const slotsByPeer = new Map<string, SlotInfo[]>()
    await Promise.all(
      peers.slice(0, PEERDB_ALERT_MAX_MIRRORS).map(async (peer) => {
        slotsByPeer.set(peer, await safe(() => r.peerSlots(peer), []))
      })
    )
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
      const st = statuses.get(m.name)
      const ec = errorCounts.get(m.name) ?? {
        count: 0,
        source: 'unavailable' as const,
      }
      const clones = st?.cdcStatus?.snapshotStatus?.clones
      const snapshotStalled =
        Array.isArray(clones) &&
        clones.length > 0 &&
        clones.filter((c) => c?.fetchCompleted && c?.consolidateCompleted)
          .length < clones.length
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
        recentErrorCount: ec.count,
        errorCountSource: ec.source,
        slotLagMb: slotLagByMirror.get(m.name) ?? null,
        snapshotStalled,
      }
    })

    const hasLagSample = signals.some((s) => s.lagSec !== null)
    const hasErrorSample = signals.some((s) => s.errorCountSource === 'log-api')
    const hasSlotSample = signals.some((s) => s.slotLagMb !== null)

    return {
      signals,
      metrics: {
        signalsCollected: signals.length,
        hasLagSample,
        hasErrorSample,
        hasSlotSample,
        mirrorsChecked: scoped.length,
        errored,
      },
      fleetMaxSlotLagMb,
    }
  } catch {
    return empty()
  }
}
