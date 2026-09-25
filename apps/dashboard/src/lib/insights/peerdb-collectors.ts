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
} from '../peerdb/types'
import type { InsightCandidate, InsightSeverity } from './types'

import { summarizePeerDBFleet } from '../peerdb/fleet-metrics'
import {
  checkFailedMirrors,
  checkMirrorErrors,
  checkPausedMirrors,
  checkSlotLag,
  checkSnapshotStalled,
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
 * `PEERDB_API_URL` is unset. The `peerdb-config` import is dynamic so a
 * runtime without node built-ins (Workers `Buffer`) degrades to empty reads
 * instead of failing module evaluation.
 */
async function defaultReader(): Promise<PeerDBSnapshotReader> {
  const mod = await import('../peerdb/peerdb-config').catch(() => null)
  const getConfig = mod?.getPeerDBConfig as
    | (() => { baseUrl: string } | null)
    | undefined
  const fetchFn = mod?.peerdbFetch as
    | (<T>(path: string, init?: RequestInit) => Promise<T>)
    | undefined
  const unconfigured: PeerDBSnapshotReader = {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => 0,
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
    const lag = checkSlotLag(fleet.maxSlotLagMb, fleet.maxSlotLagLabel)
    if (lag) out.push(lag)

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
