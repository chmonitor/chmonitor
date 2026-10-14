/**
 * Incident system snapshot.
 *
 * Captures a compact, point-in-time picture of a single host's runtime state
 * so it can be attached to an incident/alert for context: the heaviest running
 * queries, active/stuck merges, memory + disk pressure, and replication lag.
 *
 * Design goals:
 * - **Resilient**: each sub-collector is wrapped so a single failing query
 *   (missing table, read-only cluster, permission) yields `null` for that
 *   field instead of aborting the whole snapshot. A partial snapshot is always
 *   returned.
 * - **Small payload**: only a few running-query rows (query text truncated),
 *   scalar summaries for everything else. This is meant to be embedded, not
 *   browsed.
 * - **Read-only**: uses the same `readOnlyQuery` primitive the insight
 *   collectors use, so it never mutates cluster state.
 *
 * This module is standalone/consumable — it does NOT wire itself into any
 * alert payload; a later slice does that.
 */

import { readOnlyQuery } from '../ai/agent/tools/helpers'

/** How many running queries to include (kept small on purpose). */
const TOP_QUERY_LIMIT = 5
/** Max query-text length retained per running query. */
const QUERY_TEXT_MAX = 200
/** A merge running longer than this (seconds) is flagged as "stuck". */
const STUCK_MERGE_SECONDS = 600

/** One heavy running query at incident time. */
export interface RunningQuerySnapshot {
  readonly queryId: string
  readonly user: string
  readonly elapsed: number
  readonly memoryMb: number
  /** Truncated query text (up to QUERY_TEXT_MAX chars). */
  readonly query: string
}

/** Aggregate view of active merges at incident time. */
export interface MergeSnapshot {
  readonly active: number
  /** Active merges running longer than STUCK_MERGE_SECONDS. */
  readonly stuck: number
  /** Longest-running merge in seconds (null when none). */
  readonly maxElapsed: number | null
}

/** Compact system state captured at incident time. */
export interface IncidentSnapshot {
  readonly hostId: number
  /** ISO timestamp the snapshot was captured. */
  readonly capturedAt: string
  /** Heaviest running queries, or null if the query failed. */
  readonly topQueries: RunningQuerySnapshot[] | null
  /** Active/stuck merge summary, or null if the query failed. */
  readonly merges: MergeSnapshot | null
  /** Memory usage as a percentage of total OS memory, or null. */
  readonly memoryUsagePct: number | null
  /** Disk usage as a percentage of total disk space, or null. */
  readonly diskUsagePct: number | null
  /** Most-delayed replica in seconds, or null. */
  readonly replicationLagSeconds: number | null
}

/** Coerce a cell to a finite number, or null. */
function num(val: unknown): number | null {
  if (val === null || val === undefined) return null
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : null
}

/** Coerce a cell to a string ('' when null/undefined). */
function str(val: unknown): string {
  return val === null || val === undefined ? '' : String(val)
}

/**
 * Run a read-only query and return its rows, or null on any failure. Keeps
 * every sub-collector best-effort so one failure never aborts the snapshot.
 */
async function safeRows(
  sql: string,
  hostId: number
): Promise<Record<string, unknown>[] | null> {
  try {
    const rows = await readOnlyQuery({ query: sql, hostId })
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null
  } catch {
    return null
  }
}

/** Heaviest running queries by elapsed time. */
async function collectTopQueries(
  hostId: number
): Promise<RunningQuerySnapshot[] | null> {
  const rows = await safeRows(
    `SELECT
       query_id,
       user,
       round(elapsed, 2) AS elapsed,
       round(memory_usage / 1048576, 1) AS memory_mb,
       substring(query, 1, ${QUERY_TEXT_MAX}) AS query
     FROM system.processes
     ORDER BY elapsed DESC
     LIMIT ${TOP_QUERY_LIMIT}`,
    hostId
  )
  if (rows === null) return null
  return rows.map((r) => ({
    queryId: str(r.query_id),
    user: str(r.user),
    elapsed: num(r.elapsed) ?? 0,
    memoryMb: num(r.memory_mb) ?? 0,
    query: str(r.query),
  }))
}

/** Active/stuck merge summary. */
async function collectMerges(hostId: number): Promise<MergeSnapshot | null> {
  const rows = await safeRows(
    `SELECT
       count() AS active,
       countIf(elapsed > ${STUCK_MERGE_SECONDS}) AS stuck,
       round(max(elapsed), 2) AS max_elapsed
     FROM system.merges`,
    hostId
  )
  if (rows === null) return null
  const row = rows[0] ?? {}
  return {
    active: num(row.active) ?? 0,
    stuck: num(row.stuck) ?? 0,
    maxElapsed: num(row.max_elapsed),
  }
}

/** Memory usage as a percentage of total OS memory. */
async function collectMemoryUsagePct(hostId: number): Promise<number | null> {
  const rows = await safeRows(
    `SELECT round(
       (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MemoryResident')
       * 100.0
       / nullIf((SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal'), 0),
       1) AS value`,
    hostId
  )
  return rows ? num(rows[0]?.value) : null
}

/** Disk usage as a percentage of total disk space. */
async function collectDiskUsagePct(hostId: number): Promise<number | null> {
  const rows = await safeRows(
    `SELECT round(
       (sum(total_space) - sum(free_space)) * 100.0 / nullIf(sum(total_space), 0),
       1) AS value
     FROM system.disks`,
    hostId
  )
  return rows ? num(rows[0]?.value) : null
}

/**
 * Most-delayed replica in seconds. Mirrors the reliability collector's
 * `max(absolute_delay)` query in lib/insights/collectors.ts.
 */
async function collectReplicationLag(hostId: number): Promise<number | null> {
  const rows = await safeRows(
    `SELECT max(absolute_delay) AS value FROM system.replicas`,
    hostId
  )
  return rows ? num(rows[0]?.value) : null
}

/**
 * Capture a compact snapshot of a host's system state at incident time.
 *
 * Never throws: each sub-collector is independent and best-effort, so the
 * returned snapshot may carry `null` for any field whose query failed while
 * the rest resolve normally.
 */
export async function captureIncidentSnapshot(
  hostId: number
): Promise<IncidentSnapshot> {
  const [topQueries, merges, memoryUsagePct, diskUsagePct, replicationLag] =
    await Promise.all([
      collectTopQueries(hostId),
      collectMerges(hostId),
      collectMemoryUsagePct(hostId),
      collectDiskUsagePct(hostId),
      collectReplicationLag(hostId),
    ])

  return {
    hostId,
    capturedAt: new Date().toISOString(),
    topQueries,
    merges,
    memoryUsagePct,
    diskUsagePct,
    replicationLagSeconds: replicationLag,
  }
}
