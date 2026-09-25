/**
 * Deterministic PeerDB insight collectors.
 *
 * The PeerDB analog of `postgres-collectors.ts`. The ClickHouse alert sweep is
 * SQL-rule-centric, so PeerDB uses this dedicated collector path instead of
 * faking an `AlertRuleDef.sql` — collection reads the read-only PeerDB REST
 * surface (the same allowlisted endpoints the `/api/v1/peerdb/*` proxy
 * exposes: mirrors list/status/logs, peers/slots) through an injectable
 * snapshot reader and classifies via the pure `./peerdb-checks` functions.
 *
 * Collectors NEVER throw — unconfigured PeerDB, an unreachable flow-api, or a
 * single failed upstream call yields an empty list (or a partial snapshot) so
 * the engine — and the ClickHouse sweep around it — degrades gracefully.
 * Per-connection (`?connection=<id>`) sweep is out of v1: collectors read the
 * env-wide deployment config only.
 */

import type {
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorListItem,
  MirrorStatusResponse,
  PeerSlotResponse,
  SlotInfo,
  SlotLagHistoryResponse,
  SlotLagPoint,
} from '../peerdb/types'
import type { InsightCandidate, InsightSeverity } from './types'

import { summarizePeerDBFleet, worstSlotRef } from '../peerdb/fleet-metrics'
import {
  buildPeerDBAuthHeader,
  envPeerDBConfig,
  type ResolvedPeerDBConfig,
} from '../peerdb/peerdb-auth'
import {
  checkFailedMirrors,
  checkMirrorErrors,
  checkPausedMirrors,
  checkSlotLag,
  checkSlotLagTrend,
  checkSnapshotStalled,
  checkTerminatedMirrors,
} from './peerdb-checks'

/**
 * Read-only PeerDB snapshot source. The default implementation talks to the
 * env-configured flow-api via `peerdbFetch`; tests (and the Workers runtime,
 * whose proxy path resolves config from bindings) inject a stub. Every method
 * is expected to be best-effort — implementations should return `null`/`[]` on
 * failure rather than throw, and collectors defend with `.catch` regardless.
 */
export interface PeerDBSnapshotReader {
  listMirrors(): Promise<MirrorListItem[]>
  /** Per-mirror `POST /v1/mirrors/status` payload, or null when unreadable. */
  mirrorStatus(name: string): Promise<MirrorStatusResponse | null>
  /** Recent error/log entry count for a mirror (0 when unreadable). */
  mirrorErrorCount(name: string): Promise<number>
  /** Replication slots per source peer name. */
  peerSlots(peer: string): Promise<SlotInfo[]>
  /**
   * Lag history for one slot, oldest first (`POST /v1/peers/slots/lag_history`).
   * Entries are `size` in MiB; a point upstream could not report is `null` (not
   * `0`) so a hole in the series is not read as a collapse to zero.
   */
  peerSlotLagHistory(
    peer: string,
    slotName: string | null
  ): Promise<readonly (number | null)[]>
  /** Source peer names (from `GET /v1/peers/list`). */
  listSourcePeers(): Promise<string[]>
}

/** Maximum mirrors to fan out per-mirror status/logs reads to (bounds the sweep). */
export const PEERDB_SWEEP_MAX_MIRRORS = 50

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

/**
 * Default env-configured reader. Gate: returns null reads when
 * `PEERDB_API_URL` is unset. Built on the Workers-safe `envPeerDBConfig` /
 * `buildPeerDBAuthHeader` path (the same config + auth the proxy routes use),
 * so `basic` AND `bearer` deployments collect identically — and so this module
 * stays statically importable in runtimes without node built-ins (no `Buffer`,
 * no module-scope `process.env` reads). Upstream timeout is read lazily per
 * call so a bridged `PEERDB_FETCH_TIMEOUT_MS` always applies.
 */
async function defaultReader(
  bindings: Record<string, string | undefined> = defaultBindings()
): Promise<PeerDBSnapshotReader> {
  const unconfigured: PeerDBSnapshotReader = {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => 0,
    peerSlots: async () => [],
    peerSlotLagHistory: async () => [],
    listSourcePeers: async () => [],
  }
  let config: ResolvedPeerDBConfig | null = null
  try {
    config = envPeerDBConfig(bindings)
  } catch {
    return unconfigured
  }
  if (!config) return unconfigured

  const fetchFn = <T>(path: string, init?: RequestInit): Promise<T> =>
    peerDBFetch<T>(config as ResolvedPeerDBConfig, path, bindings, init)

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
      safe(async () => {
        const res = await fetchFn<{ errors?: unknown[]; total?: number }>(
          '/v1/mirrors/logs',
          { method: 'POST', body: JSON.stringify({ flow_job_name: name }) }
        )
        if (typeof res?.total === 'number') return res.total
        return Array.isArray(res?.errors) ? res.errors.length : 0
      }, 0),
    peerSlots: (peer) =>
      safe(async () => {
        const res = await fetchFn<PeerSlotResponse>(
          `/v1/peers/slots/${encodeURIComponent(peer)}`
        )
        return Array.isArray(res?.slotData) ? res.slotData : []
      }, []),
    peerSlotLagHistory: (peer, slotName) =>
      safe(async () => {
        if (!peer || !slotName) return []
        const res = await fetchFn<SlotLagHistoryResponse>(
          '/v1/peers/slots/lag_history',
          {
            method: 'POST',
            body: JSON.stringify({
              peerName: peer,
              slotName,
              timeSince: '1day',
            }),
          }
        )
        const points: SlotLagPoint[] = Array.isArray(res?.data) ? res.data : []
        // Non-numeric sizes stay `null` so `checkSlotLagTrend` drops them rather
        // than reading a hole in the series as a collapse to 0 MiB.
        return points.map((p) => {
          const n = Number(p?.size)
          return Number.isFinite(n) ? n : null
        })
      }, []),
    listSourcePeers: () =>
      safe(async () => {
        const res = await fetchFn<ListPeersResponse>('/v1/peers/list')
        const names = [
          ...(res?.sourceItems ?? []).map((p) => p?.name),
          ...((res?.items ?? []).map((p) => p?.name) as string[]),
        ]
        return [...new Set(names.filter((n) => typeof n === 'string' && n))]
      }, []),
  }
}

/**
 * Bindings for the default reader. Prefers an explicit argument (tests, and
 * callers holding Worker bindings); falls back to `process.env` on node —
 * which is also where `bridgePeerDBEnv` copies Worker bindings, so both
 * runtimes resolve identically. Never throws.
 */
function defaultBindings(): Record<string, string | undefined> {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return { ...process.env }
    }
  } catch {
    // ignore — fall through to empty
  }
  return {}
}

/** Lazily-read upstream timeout (see the route's `resolveFetchTimeoutMs`). */
function resolveTimeoutMs(
  bindings: Record<string, string | undefined>
): number {
  const raw = (bindings.PEERDB_FETCH_TIMEOUT_MS ?? '').trim()
  if (!raw) return 10_000
  const parsed = Math.floor(Number(raw))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000
}

async function peerDBFetch<T>(
  config: ResolvedPeerDBConfig,
  path: string,
  bindings: Record<string, string | undefined>,
  init?: RequestInit
): Promise<T> {
  const timeoutMs = resolveTimeoutMs(bindings)
  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
        ...buildPeerDBAuthHeader(config),
      },
    })
    if (!response.ok) {
      throw new Error(`PeerDB API error ${response.status}`)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Run all PeerDB collectors and return de-duplicated candidates, highest
 * severity first. Mirrors `collectPostgresInsights`. Never throws.
 *
 * @param reader  Snapshot source; defaults to the env-configured flow-api
 *   (empty when PeerDB is unconfigured/unreachable).
 */
export async function collectPeerDBInsights(
  reader?: PeerDBSnapshotReader
): Promise<InsightCandidate[]> {
  try {
    const r = reader ?? (await defaultReader().catch(() => null))
    if (!r) return []

    const mirrors = await safe(() => r.listMirrors(), [])
    if (mirrors.length === 0) return []
    const scoped = mirrors.slice(0, PEERDB_SWEEP_MAX_MIRRORS)

    // Fleet status from the list rows, refined per-mirror where readable.
    const statuses = new Map<string, MirrorStatusResponse>()
    await Promise.all(
      scoped.map(async (m) => {
        if (!m?.name) return
        const s = await safe(() => r.mirrorStatus(m.name), null)
        if (s) statuses.set(m.name, s)
      })
    )

    // Slots across source peers (bounded by the same mirror cap in practice —
    // peers are typically fewer than mirrors).
    const peers = await safe(() => r.listSourcePeers(), [])
    const slotEntries: { name: string; slots: SlotInfo[] }[] =
      await Promise.all(
        peers.slice(0, PEERDB_SWEEP_MAX_MIRRORS).map(async (peer) => ({
          name: peer,
          slots: await safe(() => r.peerSlots(peer), []),
        }))
      )

    const fleet = summarizePeerDBFleet({
      mirrors: scoped,
      statuses,
      slots: slotEntries,
    })

    const out: InsightCandidate[] = []
    const failed = checkFailedMirrors(fleet.failedMirrors)
    if (failed) out.push(failed)
    const paused = checkPausedMirrors(fleet.pausedMirrors)
    if (paused) out.push(paused)
    const terminated = checkTerminatedMirrors(fleet.terminatedMirrors)
    if (terminated) out.push(terminated)
    const lag = checkSlotLag(fleet.maxSlotLagMb, fleet.maxSlotLagLabel)
    if (lag) out.push(lag)

    // Lag *divergence* on the same worst slot. Needs one extra allowlisted call
    // (`lag_history`), scoped to the single worst slot so the sweep cost stays
    // flat regardless of fleet size. Unreachable history just yields [] and the
    // check declines — a missing history must never suppress the absolute-lag
    // card above.
    const worst = worstSlotRef(slotEntries)
    if (worst) {
      const history = await safe(
        () => r.peerSlotLagHistory(worst.peer, worst.slotName),
        []
      )
      const trend = checkSlotLagTrend(history, worst.label)
      if (trend) out.push(trend)
    }

    // Per-mirror error volume + snapshot stalls, evaluated concurrently and
    // capped so one noisy fleet cannot flood the panel.
    const perMirror = await Promise.all(
      scoped.map(async (m): Promise<InsightCandidate[]> => {
        if (!m?.name) return []
        const found: InsightCandidate[] = []
        const errors = await safe(() => r.mirrorErrorCount(m.name), 0)
        const errCandidate = checkMirrorErrors(m.name, errors)
        if (errCandidate) found.push(errCandidate)
        const st = statuses.get(m.name)
        const clones = st?.cdcStatus?.snapshotStatus?.clones
        if (Array.isArray(clones) && clones.length > 0) {
          const done = clones.filter(
            (c) => c?.fetchCompleted && c?.consolidateCompleted
          ).length
          const stalled = checkSnapshotStalled(m.name, clones.length, done)
          if (stalled) found.push(stalled)
        }
        return found
      })
    )
    // Cap per-mirror error findings so a fleet-wide outage surfaces the
    // fleet-level `peerdb_failed_mirrors` card plus a sample, not N rows.
    out.push(...perMirror.flat().slice(0, 5))

    const seen = new Set<string>()
    const merged: InsightCandidate[] = []
    for (const candidate of out) {
      const dedupeKey = `${candidate.category}:${candidate.metric ?? candidate.title}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      merged.push(candidate)
    }

    const rank: Record<InsightSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    }
    return merged.sort((a, b) => rank[a.severity] - rank[b.severity])
  } catch {
    return []
  }
}
