/**
 * PeerDB tools for the agent (env-gated, read-only).
 *
 * Two bounded primitives, both over the same fixed allowlisted paths:
 * - `get_peerdb_mirror_status` — mirror state/lag/rows-synced, in two modes:
 *   - Fleet mode (no `mirrorName`): every configured mirror with per-mirror
 *     state/lag/rows-synced, sorted worst-first, so "which mirrors are lagging
 *     or failing?" is one call.
 *   - Detail mode (`mirrorName`): state, authoritative rows-synced total,
 *     per-table counts, recent CDC batches, and recent error logs for one
 *     mirror, each explicitly capped.
 * - `get_peerdb_metrics` — the *metrics* surface the `/peerdb` UI already
 *   reads but the agent could not reach: replication-slot lag and its history,
 *   CDC rows-synced throughput, snapshot/initial-load progress, per-peer active
 *   queries, and fleet aggregates. One `metric` discriminator plus optional
 *   `peerName` / `mirrorName` / `slotName` / `window`.
 *
 * All reads go through `peerdbRequest` (fixed allowlisted paths, credential
 * attached server-side). The model supplies at most mirror/peer/slot names —
 * never a URL, path, or SQL — and every one is validated + URL-encoded.
 * Mirror and peer `config` blocks (which may embed connector secrets) are
 * stripped before results reach the model. Mutating PeerDB operations
 * (create/pause/resume/drop) are unreachable by construction.
 */

import { z } from 'zod'

import type {
  CDCBatch,
  CDCTableTotalCountsResponse,
  GetCDCBatchesResponse,
  GraphResponse,
  InitialLoadSummaryResponse,
  ListMirrorLogsResponse,
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorListItem,
  MirrorLog,
  MirrorStatusResponse,
  PeerListItem,
  PeerSlotResponse,
  PeerStatResponse,
  SlotInfo,
  SlotLagHistoryResponse,
  TotalRowsSyncedResponse,
} from '@/lib/peerdb/types'

import { capResultRows, truncationNote } from './helpers'
import {
  assertValidMirrorName,
  assertValidPeerName,
  assertValidSlotName,
  PeerDBAgentError,
  peerdbRequest,
} from './peerdb-helpers'
import { dynamicTool } from 'ai'
import { summarizePeerDBFleet } from '@/lib/peerdb/fleet-metrics'
import {
  SLOT_LAG_CRITICAL_MB,
  SLOT_LAG_WARN_MB,
} from '@/lib/peerdb/slot-lag-thresholds'

/** Caps — every list the tool returns is bounded before serialization. */
export const PEERDB_FLEET_LIMIT = 50
export const PEERDB_STATUS_FANOUT_LIMIT = 25
export const PEERDB_TABLES_LIMIT = 50
export const PEERDB_BATCHES_LIMIT = 10
export const PEERDB_LOGS_LIMIT = 10
/** `get_peerdb_metrics` caps — one per new result set. */
export const PEERDB_PEER_FANOUT_LIMIT = 25
export const PEERDB_PEER_QUERIES_LIMIT = 20
/** Time-series points (CDC graph buckets, slot-lag samples) returned. */
export const PEERDB_SERIES_LIMIT = 240
const ERROR_PREVIEW_CHARS = 300
/** Peer `pg_stat_activity` query text is unbounded; truncate like query-tools. */
const PEER_QUERY_PREVIEW_CHARS = 500
/**
 * A slot-lag delta under this (MiB) counts as flat. Below the graph noise
 * floor of the 512 MiB warn threshold, so a healthy slot never reads as
 * "growing" just from sampling jitter.
 */
const SLOT_LAG_FLAT_DELTA_MB = 64

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function errorPreview(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  return v.length > ERROR_PREVIEW_CHARS
    ? `${v.slice(0, ERROR_PREVIEW_CHARS)}…`
    : v
}

/**
 * Worst-first rank for fleet triage: failed mirrors before non-running ones
 * before running ones (highest lag first; unknown lag last).
 */
function fleetRank(state: string | undefined): number {
  if (state === 'STATUS_FAILED') return 0
  if (
    state === 'STATUS_PAUSING' ||
    state === 'STATUS_PAUSED' ||
    state === 'STATUS_SNAPSHOT' ||
    state === 'STATUS_SETUP' ||
    state === 'STATUS_TERMINATING' ||
    state === 'STATUS_TERMINATED' ||
    state === 'STATUS_UNKNOWN'
  )
    return 1
  return 2
}

interface FleetEntry {
  name: string
  state: string | undefined
  is_cdc: boolean | undefined
  source: string | undefined
  destination: string | undefined
  lag_sec: number | null
  rows_synced: number | null
  error: string | null
  status_error?: string
}

async function fetchFleetStatus(
  mirror: MirrorListItem
): Promise<Pick<FleetEntry, 'state' | 'lag_sec' | 'rows_synced' | 'error'>> {
  const status = await peerdbRequest<MirrorStatusResponse>(
    '/v1/mirrors/status',
    {
      method: 'POST',
      body: { flowJobName: mirror.name, includeFlowInfo: false },
    }
  )
  return {
    state: status.currentFlowState ?? mirror.status,
    lag_sec: toNumber(status.lagSec),
    rows_synced: toNumber(status.cdcStatus?.rowsSynced),
    error: errorPreview(status.errorMessage),
  }
}

async function getFleetMirrors() {
  const list = await peerdbRequest<ListMirrorsResponse>('/v1/mirrors/list')
  const mirrors = Array.isArray(list.mirrors) ? list.mirrors : []
  const { data: capped, truncated } = capResultRows(mirrors, PEERDB_FLEET_LIMIT)

  // Per-mirror status fan-out, bounded so a large fleet stays one cheap call.
  const withStatus = capped.slice(0, PEERDB_STATUS_FANOUT_LIMIT)
  const settled = await Promise.allSettled(withStatus.map(fetchFleetStatus))

  const entries: FleetEntry[] = capped.map((mirror, i) => {
    const base = {
      name: mirror.name,
      state: mirror.status,
      is_cdc: mirror.isCdc,
      source: mirror.sourceName,
      destination: mirror.destinationName,
      lag_sec: null as number | null,
      rows_synced: null as number | null,
      error: null as string | null,
    }
    if (i >= settled.length) return base
    const r = settled[i]
    if (r.status === 'fulfilled') return { ...base, ...r.value }
    const reason = r.reason
    return {
      ...base,
      status_error:
        reason instanceof PeerDBAgentError
          ? reason.message
          : 'Mirror status unavailable',
    }
  })

  entries.sort((a, b) => {
    const rank = fleetRank(a.state) - fleetRank(b.state)
    if (rank !== 0) return rank
    if (a.lag_sec === null && b.lag_sec === null) return 0
    if (a.lag_sec === null) return 1
    if (b.lag_sec === null) return -1
    return b.lag_sec - a.lag_sec
  })

  return {
    mode: 'fleet' as const,
    count: entries.length,
    mirrors: entries,
    status_fanout_truncated: capped.length > PEERDB_STATUS_FANOUT_LIMIT,
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_FLEET_LIMIT) }),
  }
}

async function getMirrorDetail(mirrorName: string) {
  assertValidMirrorName(mirrorName)
  const encoded = encodeURIComponent(mirrorName)
  const statusBody = { flowJobName: mirrorName, includeFlowInfo: true }

  const [status, totalSynced, tableCounts, batches, logs] = await Promise.all([
    peerdbRequest<MirrorStatusResponse>('/v1/mirrors/status', {
      method: 'POST',
      body: statusBody,
    }),
    // Best-effort enrichments: older PeerDB versions / QRep mirrors may not
    // serve every endpoint, so a single missing one must not fail the call.
    peerdbRequest<TotalRowsSyncedResponse>(
      `/v1/mirrors/total_rows_synced/${encoded}`
    ).catch(() => null),
    peerdbRequest<CDCTableTotalCountsResponse>(
      `/v1/mirrors/cdc/table_total_counts/${encoded}`
    ).catch(() => null),
    peerdbRequest<GetCDCBatchesResponse>('/v1/mirrors/cdc/batches', {
      method: 'POST',
      body: {
        flowJobName: mirrorName,
        page: 0,
        numPerPage: PEERDB_BATCHES_LIMIT,
      },
    }).catch(() => null),
    peerdbRequest<ListMirrorLogsResponse>('/v1/mirrors/logs', {
      method: 'POST',
      body: {
        flowJobName: mirrorName,
        level: 'error',
        page: 0,
        numPerPage: PEERDB_LOGS_LIMIT,
      },
    }).catch(() => null),
  ])

  // NOTE: `status.cdcStatus.config` / `status.qrepStatus.config` are
  // deliberately dropped here — flow configs may embed connector secrets and
  // the model has no use for them. Only derived summaries cross the boundary.
  const cdcTables = Array.isArray(tableCounts?.tablesData)
    ? tableCounts.tablesData
    : []
  const { data: tables, truncated: tablesTruncated } = capResultRows(
    cdcTables.map((t) => ({
      table: t.tableName,
      total: t.counts?.totalCount,
      inserts: t.counts?.insertsCount,
      updates: t.counts?.updatesCount,
      deletes: t.counts?.deletesCount,
    })),
    PEERDB_TABLES_LIMIT
  )

  const cdcBatches: CDCBatch[] = Array.isArray(batches?.cdcBatches)
    ? batches.cdcBatches
    : Array.isArray(status.cdcStatus?.cdcBatches)
      ? (status.cdcStatus?.cdcBatches ?? [])
      : []
  const { data: recentBatches, truncated: batchesTruncated } = capResultRows(
    cdcBatches.map((b) => ({
      batch_id: b.batchId,
      rows: b.numRows,
      start_time: b.startTime,
      end_time: b.endTime,
    })),
    PEERDB_BATCHES_LIMIT
  )

  const logEntries: MirrorLog[] = Array.isArray(logs?.errors) ? logs.errors : []
  const { data: recentErrors, truncated: logsTruncated } = capResultRows(
    logEntries.map((l) => ({
      message: errorPreview(l.errorMessage),
      type: l.errorType,
      at: l.errorTimestamp,
    })),
    PEERDB_LOGS_LIMIT
  )

  const authoritativeTotal =
    totalSynced?.totalCount ?? totalSynced?.totalRowsSynced
  const partitions = status.qrepStatus?.partitions ?? []

  return {
    mode: 'detail' as const,
    mirror: mirrorName,
    state: status.currentFlowState,
    is_cdc: !status.qrepStatus,
    created_at: status.createdAt,
    lag_sec: toNumber(status.lagSec),
    rows_synced:
      toNumber(authoritativeTotal) ?? toNumber(status.cdcStatus?.rowsSynced),
    qrep_partitions: partitions.length,
    error: errorPreview(status.errorMessage),
    tables,
    tables_truncated: tablesTruncated,
    recent_batches: recentBatches,
    batches_truncated: batchesTruncated,
    recent_errors: recentErrors,
    logs_truncated: logsTruncated,
  }
}

// ---------------------------------------------------------------------------
// get_peerdb_metrics — the slot-lag / throughput / snapshot / fleet surface.
// ---------------------------------------------------------------------------

/** Windows PeerDB's lag-history endpoint accepts, most-recent-first. */
const LAG_WINDOWS = ['1hour', '6hours', '1day', '3days', '7days'] as const
/** CDC graph bucket sizes, matching the `/peerdb` mirror page default. */
const GRAPH_AGGREGATES = ['1min', '5min', '1hour', '1day'] as const
/**
 * The `metric` values, declared once so the zod enum and the execute() switch
 * cannot drift apart. Exported for the tool-docs/prompt assertions.
 */
export const METRIC_NAMES = [
  'fleet',
  'slots',
  'slot_lag_history',
  'rows_synced',
  'snapshot',
  'peer_stats',
] as const

type SlotHealth = 'critical' | 'warn' | 'ok' | 'unknown'

/**
 * Classify one slot's WAL lag against the shared thresholds — the same
 * `SLOT_LAG_*` constants the slot-health table and the insights checks use, so
 * the agent and the UI never disagree about what "lagging" means.
 */
function slotLagHealth(slot: SlotInfo): SlotHealth {
  const lag = toNumber(slot.lagInMb)
  if (lag === null) return 'unknown'
  if (lag >= SLOT_LAG_CRITICAL_MB) return 'critical'
  if (lag >= SLOT_LAG_WARN_MB) return 'warn'
  return 'ok'
}

function slotRank(health: SlotHealth): number {
  if (health === 'critical') return 0
  if (health === 'warn') return 1
  if (health === 'ok') return 2
  return 3
}

interface SlotRow {
  peer: string
  slot: string | undefined
  health: SlotHealth
  lag_mb: number | null
  active: boolean | undefined
  wal_status: string | undefined
}

function toSlotRows(peer: string, slots: SlotInfo[]): SlotRow[] {
  return slots.map((s) => ({
    peer,
    slot: s.slotName,
    health: slotLagHealth(s),
    lag_mb: toNumber(s.lagInMb),
    active: s.active,
    wal_status: s.walStatus,
  }))
}

function sortSlotRows(rows: SlotRow[]): SlotRow[] {
  return rows.sort((a, b) => {
    const rank = slotRank(a.health) - slotRank(b.health)
    if (rank !== 0) return rank
    if (a.lag_mb === null && b.lag_mb === null) return 0
    if (a.lag_mb === null) return 1
    if (b.lag_mb === null) return -1
    return b.lag_mb - a.lag_mb
  })
}

/** Unique peer names from a `/v1/peers/list` response, in response order. */
function peerNamesOf(list: ListPeersResponse | null): string[] {
  const all: PeerListItem[] = [
    ...(list?.sourceItems ?? []),
    ...(list?.items ?? []),
    ...(list?.destinationItems ?? []),
  ]
  return all
    .map((p) => p?.name)
    .filter(
      (n, i, a): n is string =>
        typeof n === 'string' && n.length > 0 && a.indexOf(n) === i
    )
}

/** One peer's slots: the raw upstream slots plus the model-facing rows. */
interface PeerSlots {
  raw: SlotInfo[]
  rows: SlotRow[]
}

/** Best-effort per-peer slot fetch — a missing endpoint degrades, never fails. */
async function fetchPeerSlots(peer: string): Promise<PeerSlots> {
  assertValidPeerName(peer)
  const res = await peerdbRequest<PeerSlotResponse>(
    `/v1/peers/slots/${encodeURIComponent(peer)}`
  )
  const raw = Array.isArray(res?.slotData) ? res.slotData : []
  return { raw, rows: toSlotRows(peer, raw) }
}

/**
 * Fleet aggregate: the same `summarizePeerDBFleet` the `/api/v1/peerdb-metrics`
 * route and the insight collectors use, fed by already-fetched payloads. Each
 * fan-out is capped and best-effort, so a partial PeerDB (or an older version
 * that does not serve a path) degrades to `partial: true` instead of failing.
 */
async function getFleetMetrics() {
  const list = await peerdbRequest<ListMirrorsResponse>('/v1/mirrors/list')
  const mirrors = Array.isArray(list.mirrors) ? list.mirrors : []
  const { data: capped, truncated } = capResultRows(mirrors, PEERDB_FLEET_LIMIT)
  const scoped = capped.slice(0, PEERDB_STATUS_FANOUT_LIMIT)

  const [statusResults, rowsResults, peersRes] = await Promise.all([
    Promise.allSettled(
      scoped.map((m) =>
        peerdbRequest<MirrorStatusResponse>('/v1/mirrors/status', {
          method: 'POST',
          body: { flowJobName: m.name, includeFlowInfo: false },
        })
      )
    ),
    Promise.allSettled(
      scoped.map((m) => {
        assertValidMirrorName(m.name)
        return peerdbRequest<TotalRowsSyncedResponse>(
          `/v1/mirrors/total_rows_synced/${encodeURIComponent(m.name)}`
        )
      })
    ),
    peerdbRequest<ListPeersResponse>('/v1/peers/list').catch(() => null),
  ])

  let partial = false
  const statuses = new Map<string, MirrorStatusResponse>()
  statusResults.forEach((r, i) => {
    if (r.status === 'fulfilled' && scoped[i]) {
      statuses.set(scoped[i].name, r.value)
    } else {
      partial = true
    }
  })

  const rowsSynced = new Map<string, number>()
  rowsResults.forEach((r, i) => {
    const name = scoped[i]?.name
    if (r.status !== 'fulfilled' || !name) {
      partial = true
      return
    }
    const n = toNumber(r.value?.totalRowsSynced ?? r.value?.totalCount)
    if (n !== null) rowsSynced.set(name, n)
  })

  const peers = peerNamesOf(peersRes)
  const slotScoped = peers.slice(0, PEERDB_PEER_FANOUT_LIMIT)
  const slotResults = await Promise.allSettled(slotScoped.map(fetchPeerSlots))
  const slotEntries: { name: string; slots: SlotInfo[] }[] = []
  const slotRows: SlotRow[] = []
  slotResults.forEach((r, i) => {
    const peer = slotScoped[i]
    if (!peer) return
    if (r.status === 'fulfilled') {
      slotEntries.push({ name: peer, slots: r.value.raw })
      slotRows.push(...r.value.rows)
    } else {
      partial = true
    }
  })

  // Delegate the aggregation itself — never reimplement the bucketing here.
  const metrics = summarizePeerDBFleet({
    mirrors: scoped,
    statuses,
    slots: slotEntries,
    rowsSynced,
  })

  const { data: worstSlots, truncated: slotsTruncated } = capResultRows(
    sortSlotRows(slotRows),
    PEERDB_FLEET_LIMIT
  )

  return {
    mode: 'fleet' as const,
    total_mirrors: metrics.totalMirrors,
    by_status: metrics.byStatus,
    cdc_mirrors: metrics.cdcMirrors,
    qrep_mirrors: metrics.qrepMirrors,
    failed_mirrors: metrics.failedMirrors,
    paused_mirrors: metrics.pausedMirrors,
    total_rows_synced: metrics.totalRowsSynced,
    peers_seen: peers.length,
    worst_slot_lag_mb: metrics.maxSlotLagMb,
    worst_slot_label: metrics.maxSlotLagLabel,
    worst_slots: worstSlots,
    partial,
    peers_truncated: peers.length > PEERDB_PEER_FANOUT_LIMIT,
    status_fanout_truncated: capped.length > PEERDB_STATUS_FANOUT_LIMIT,
    truncated,
    ...((truncated || slotsTruncated) && {
      note: truncationNote(PEERDB_FLEET_LIMIT),
    }),
  }
}

/** Replication-slot health across peers (or one peer), worst-first. */
async function getSlotHealth(peerName?: string) {
  if (peerName !== undefined) assertValidPeerName(peerName)
  const peersRes = peerName
    ? null
    : await peerdbRequest<ListPeersResponse>('/v1/peers/list')
  const peers = peerName ? [peerName] : peerNamesOf(peersRes)
  const { data: scoped, truncated: peerTruncated } = capResultRows(
    peers,
    PEERDB_PEER_FANOUT_LIMIT
  )

  const settled = await Promise.allSettled(scoped.map(fetchPeerSlots))
  const rows: SlotRow[] = []
  const failures: { peer: string; error: string }[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      rows.push(...r.value.rows)
      return
    }
    const reason = r.reason
    failures.push({
      peer: scoped[i],
      error:
        reason instanceof PeerDBAgentError
          ? reason.message
          : 'Slot data unavailable',
    })
  })
  const partial = failures.length > 0

  const { data: worst, truncated } = capResultRows(
    sortSlotRows(rows),
    PEERDB_FLEET_LIMIT
  )

  return {
    mode: 'slots' as const,
    peer: peerName ?? null,
    peers_checked: scoped.length,
    slots: worst,
    failures,
    partial,
    peers_truncated: peerTruncated,
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_FLEET_LIMIT) }),
  }
}

/**
 * Slot-lag history for one peer slot, plus the derived trend the UI chart
 * shows: is the slot catching up, falling behind, or flat?
 */
async function getSlotLagHistory(
  peerName: string,
  slotName: string,
  window: (typeof LAG_WINDOWS)[number]
) {
  assertValidPeerName(peerName)
  assertValidSlotName(slotName)

  const res = await peerdbRequest<SlotLagHistoryResponse>(
    '/v1/peers/slots/lag_history',
    { method: 'POST', body: { peerName, slotName, timeSince: window } }
  )
  const points = Array.isArray(res?.data) ? res.data : []
  const { data: sampled, truncated } = capResultRows(
    points,
    PEERDB_SERIES_LIMIT
  )
  const series = sampled.map((p) => ({
    time: p.time,
    lag_mb: toNumber(p.size),
  }))

  const lags = series
    .map((p) => p.lag_mb)
    .filter((n): n is number => n !== null)
  const first = lags[0] ?? null
  const last = lags[lags.length - 1] ?? null
  const peak = lags.length ? Math.max(...lags) : null
  const delta = first !== null && last !== null ? last - first : null

  let trend: 'growing' | 'recovering' | 'flat' | 'unknown' = 'unknown'
  if (delta !== null) {
    if (delta > SLOT_LAG_FLAT_DELTA_MB) trend = 'growing'
    else if (delta < -SLOT_LAG_FLAT_DELTA_MB) trend = 'recovering'
    else trend = 'flat'
  }

  return {
    mode: 'slot_lag_history' as const,
    peer: peerName,
    slot: slotName,
    window,
    first_lag_mb: first,
    last_lag_mb: last,
    peak_lag_mb: peak,
    delta_mb: delta,
    trend,
    points: series.length,
    series,
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_SERIES_LIMIT) }),
  }
}

/**
 * CDC rows-synced throughput for one mirror — the "how many rows, and how
 * fast?" time series, plus current/peak rows-per-second.
 */
async function getRowsSyncedSeries(
  mirrorName: string,
  aggregate: (typeof GRAPH_AGGREGATES)[number]
) {
  assertValidMirrorName(mirrorName)
  const res = await peerdbRequest<GraphResponse>('/v1/mirrors/cdc/graph', {
    method: 'POST',
    body: { flowJobName: mirrorName, aggregateType: aggregate },
  })
  const points = Array.isArray(res?.data) ? res.data : []
  const { data: sampled, truncated } = capResultRows(
    points,
    PEERDB_SERIES_LIMIT
  )
  const series = sampled.map((p) => ({
    time: p.time,
    rows: toNumber(p.rows),
  }))

  const rowsPerBucket = series
    .map((p) => p.rows)
    .filter((n): n is number => n !== null)
  // Use the second-to-last complete bucket when available: the newest bucket is
  // still filling and would understate throughput (same reasoning as the
  // mirror metrics panel).
  const lastComplete = rowsPerBucket[rowsPerBucket.length - 2] ?? null
  const bucketSeconds = {
    '1min': 60,
    '5min': 300,
    '1hour': 3600,
    '1day': 86400,
  }[aggregate]
  const rowsPerSec = lastComplete !== null ? lastComplete / bucketSeconds : null
  const peakRowsPerSec = rowsPerBucket.length
    ? Math.max(...rowsPerBucket) / bucketSeconds
    : null

  return {
    mode: 'rows_synced' as const,
    mirror: mirrorName,
    aggregate,
    total_rows: toNumber(res?.totalRows),
    current_rows_per_sec: rowsPerSec,
    peak_rows_per_sec: peakRowsPerSec,
    buckets: series.length,
    series,
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_SERIES_LIMIT) }),
  }
}

/** Snapshot / initial-load (clone) progress for one mirror, per table. */
async function getSnapshotProgress(mirrorName: string) {
  assertValidMirrorName(mirrorName)
  const encoded = encodeURIComponent(mirrorName)
  const res = await peerdbRequest<InitialLoadSummaryResponse>(
    `/v1/mirrors/cdc/initial_load/${encoded}`
  )
  const summaries = Array.isArray(res?.tableSummaries) ? res.tableSummaries : []
  const { data: tables, truncated } = capResultRows(
    summaries,
    PEERDB_TABLES_LIMIT
  )

  let partitionsTotal = 0
  let partitionsDone = 0
  let rowsSynced = 0
  for (const t of summaries) {
    partitionsTotal += toNumber(t.numPartitionsTotal) ?? 0
    partitionsDone += toNumber(t.numPartitionsCompleted) ?? 0
    rowsSynced += toNumber(t.numRowsSynced) ?? 0
  }
  const pct =
    partitionsTotal > 0
      ? Math.round((partitionsDone / partitionsTotal) * 100 * 100) / 100
      : null

  return {
    mode: 'snapshot' as const,
    mirror: mirrorName,
    tables_total: summaries.length,
    partitions_total: partitionsTotal,
    partitions_completed: partitionsDone,
    percent_complete: pct,
    rows_synced: rowsSynced,
    tables: tables.map((t) => ({
      table: t.tableName,
      source_table: t.sourceTable,
      partitions_completed: toNumber(t.numPartitionsCompleted),
      partitions_total: toNumber(t.numPartitionsTotal),
      rows_synced: toNumber(t.numRowsSynced),
      avg_time_per_partition_ms: t.avgTimePerPartitionMs,
      fetch_completed: t.fetchCompleted,
      consolidate_completed: t.consolidateCompleted,
    })),
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_TABLES_LIMIT) }),
  }
}

/**
 * Per-peer active queries + peer identity/version. `peer.config` is dropped
 * for the same reason mirror configs are: it can embed connector credentials.
 */
async function getPeerStats(peerName: string) {
  assertValidPeerName(peerName)
  const encoded = encodeURIComponent(peerName)

  // Best-effort enrichments — an older PeerDB may not serve every path.
  const [stats, info, type] = await Promise.all([
    peerdbRequest<PeerStatResponse>(`/v1/peers/stats/${encoded}`).catch(
      () => null
    ),
    peerdbRequest<{
      version?: string
      peer?: { name?: string; type?: unknown }
    }>(`/v1/peers/info/${encoded}`).catch(() => null),
    peerdbRequest<{ type?: unknown }>(`/v1/peers/type/${encoded}`).catch(
      () => null
    ),
  ])

  const queries = Array.isArray(stats?.statData) ? stats.statData : []
  const { data: activeQueries, truncated } = capResultRows(
    queries,
    PEERDB_PEER_QUERIES_LIMIT
  )

  return {
    mode: 'peer_stats' as const,
    peer: peerName,
    peer_type: info?.peer?.type ?? type?.type,
    peerdb_version: info?.version,
    active_queries: activeQueries.map((q) => ({
      pid: q.pid,
      state: q.state,
      wait_event: q.waitEvent,
      wait_event_type: q.waitEventType,
      duration: toNumber(q.duration),
      query_start: q.queryStart,
      query:
        typeof q.query === 'string' && q.query.length > PEER_QUERY_PREVIEW_CHARS
          ? `${q.query.slice(0, PEER_QUERY_PREVIEW_CHARS)}…`
          : q.query,
    })),
    truncated,
    ...(truncated && { note: truncationNote(PEERDB_PEER_QUERIES_LIMIT) }),
  }
}

export function createPeerDBTools() {
  return {
    get_peerdb_mirror_status: dynamicTool({
      description:
        'Inspect PeerDB replication mirrors (read-only). With no arguments, list every mirror with per-mirror state, lag, and rows synced, sorted worst-first (failed > non-running > highest lag) — the first step of any "which mirrors are lagging or failing?" investigation. With `mirrorName`, return one mirror\'s state, authoritative rows-synced total, per-table insert/update/delete counts, recent CDC batches, and recent errors. Only fixed read-only PeerDB endpoints are queried; mirror configs (which may embed secrets) are stripped. Available only when PeerDB monitoring is configured.',
      inputSchema: z.object({
        mirrorName: z
          .string()
          .max(256)
          .optional()
          .describe(
            'Mirror (flow-job) name for per-mirror detail. Omit for the worst-first fleet overview.'
          ),
      }),
      execute: async (input: unknown) => {
        const { mirrorName } = input as { mirrorName?: string }
        if (mirrorName === undefined) return getFleetMirrors()
        return getMirrorDetail(mirrorName)
      },
    }),

    get_peerdb_metrics: dynamicTool({
      description:
        'PeerDB pipeline metrics beyond per-mirror status (read-only), selected by `metric`. `fleet` (default): fleet aggregates — mirrors by status, failed/paused names, CDC vs QRep split, total rows synced, and the worst replication-slot lag — plus the worst-first slot table. `slots`: replication-slot health (lag in MiB, active flag, WAL status) across all peers or one `peerName`, worst-first, classified ok/warn/critical. `slot_lag_history`: a lag time series for one `peerName`+`slotName` over `window`, with a growing/recovering/flat trend verdict. `rows_synced`: CDC rows-synced time series for one `mirrorName` with current and peak rows/sec. `snapshot`: initial-load progress for one `mirrorName`, per table with partition completion. `peer_stats`: one `peerName`\'s active queries plus its type and PeerDB version. Prefer get_peerdb_mirror_status for "which mirrors are failing?"; use this for "which slot lags, is it recovering, how fast is it syncing, how far along is the snapshot?". Only fixed read-only PeerDB endpoints are queried; mirror and peer configs (which may embed secrets) are never returned. Available only when PeerDB monitoring is configured.',
      inputSchema: z.object({
        metric: z
          .enum(METRIC_NAMES)
          .optional()
          .describe('Which metric surface to read. Defaults to `fleet`.'),
        peerName: z
          .string()
          .max(256)
          .optional()
          .describe(
            'Peer name for `slots` (optional: all peers when omitted), `slot_lag_history`, and `peer_stats`. A plain identifier — slashes, whitespace, and control characters are rejected.'
          ),
        mirrorName: z
          .string()
          .max(256)
          .optional()
          .describe(
            'Mirror (flow-job) name for `rows_synced` and `snapshot`. A plain identifier — slashes, whitespace, and control characters are rejected.'
          ),
        slotName: z
          .string()
          .max(256)
          .optional()
          .describe(
            'Replication slot name for `slot_lag_history` (required there; take it from the `slots` result).'
          ),
        window: z
          .enum(LAG_WINDOWS)
          .optional()
          .describe(
            'Lookback window for `slot_lag_history`. Defaults to `1day`.'
          ),
        aggregate: z
          .enum(GRAPH_AGGREGATES)
          .optional()
          .describe(
            'Bucket size for the `rows_synced` time series. Defaults to `1min`.'
          ),
      }),
      execute: async (input: unknown) => {
        const {
          metric = 'fleet',
          peerName,
          mirrorName,
          slotName,
          window = '1day',
          aggregate = '1min',
        } = input as {
          metric?: (typeof METRIC_NAMES)[number]
          peerName?: string
          mirrorName?: string
          slotName?: string
          window?: (typeof LAG_WINDOWS)[number]
          aggregate?: (typeof GRAPH_AGGREGATES)[number]
        }
        switch (metric) {
          case 'slots':
            return getSlotHealth(peerName)
          case 'slot_lag_history':
            if (peerName === undefined) {
              throw new Error(
                'metric `slot_lag_history` requires `peerName` (call metric `slots` first to list peers)'
              )
            }
            if (slotName === undefined) {
              throw new Error(
                'metric `slot_lag_history` requires `slotName` (call metric `slots` first to list slots)'
              )
            }
            return getSlotLagHistory(peerName, slotName, window)
          case 'rows_synced':
            if (mirrorName === undefined) {
              throw new Error(
                'metric `rows_synced` requires `mirrorName` (use get_peerdb_mirror_status to list mirrors)'
              )
            }
            return getRowsSyncedSeries(mirrorName, aggregate)
          case 'snapshot':
            if (mirrorName === undefined) {
              throw new Error(
                'metric `snapshot` requires `mirrorName` (use get_peerdb_mirror_status to list mirrors)'
              )
            }
            return getSnapshotProgress(mirrorName)
          case 'peer_stats':
            if (peerName === undefined) {
              throw new Error(
                'metric `peer_stats` requires `peerName` (call metric `slots` first to list peers)'
              )
            }
            return getPeerStats(peerName)
          default:
            return getFleetMetrics()
        }
      },
    }),
  }
}
