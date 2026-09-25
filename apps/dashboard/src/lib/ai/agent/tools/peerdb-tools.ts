/**
 * PeerDB mirror-status tool for the agent (env-gated, read-only).
 *
 * One bounded primitive — `get_peerdb_mirror_status` — with two modes:
 * - Fleet mode (no `mirrorName`): every configured mirror with per-mirror
 *   state/lag/rows-synced, sorted worst-first, so "which mirrors are lagging
 *   or failing?" is one call.
 * - Detail mode (`mirrorName`): state, authoritative rows-synced total,
 *   per-table counts, recent CDC batches, and recent error logs for one
 *   mirror, each explicitly capped.
 *
 * All reads go through `peerdbRequest` (fixed allowlisted paths, credential
 * attached server-side). The model supplies at most a mirror name — never a
 * URL, path, or SQL. Mirror `config` blocks (which may embed connector
 * secrets) are stripped before results reach the model. Mutating PeerDB
 * operations (create/pause/resume/drop) are unreachable by construction.
 */

import { z } from 'zod'

import type {
  CDCBatch,
  CDCTableTotalCountsResponse,
  GetCDCBatchesResponse,
  ListMirrorLogsResponse,
  ListMirrorsResponse,
  MirrorListItem,
  MirrorLog,
  MirrorStatusResponse,
  TotalRowsSyncedResponse,
} from '@/lib/peerdb/types'

import { capResultRows, truncationNote } from './helpers'
import {
  assertValidMirrorName,
  PeerDBAgentError,
  peerdbRequest,
} from './peerdb-helpers'
import { dynamicTool } from 'ai'

/** Caps — every list the tool returns is bounded before serialization. */
export const PEERDB_FLEET_LIMIT = 50
export const PEERDB_STATUS_FANOUT_LIMIT = 25
export const PEERDB_TABLES_LIMIT = 50
export const PEERDB_BATCHES_LIMIT = 10
export const PEERDB_LOGS_LIMIT = 10
const ERROR_PREVIEW_CHARS = 300

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
  }
}
