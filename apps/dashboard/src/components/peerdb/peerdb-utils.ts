import type { DBType, FlowStatus } from '@/lib/peerdb/types'

import { normalizeLogLevel } from '@/lib/peerdb/mirror-logs'

/**
 * PeerDB's `DBType` enum may arrive as a string name (grpc-gateway default) or
 * a numeric ordinal (when read from the catalog). Normalize both to an
 * uppercase key like "POSTGRES" so icon/label lookups are stable across
 * PeerDB versions.
 */
const DB_TYPE_BY_ORDINAL: Record<number, string> = {
  0: 'BIGQUERY',
  1: 'SNOWFLAKE',
  2: 'MONGO',
  3: 'POSTGRES',
  4: 'EVENTHUB',
  5: 'S3',
  6: 'SQLSERVER',
  7: 'MYSQL',
  8: 'CLICKHOUSE',
  9: 'KAFKA',
  10: 'PUBSUB',
  11: 'ELASTICSEARCH',
}

export function normalizeDbType(type?: DBType): string {
  if (type === undefined || type === null) return 'UNKNOWN'
  if (typeof type === 'number') return DB_TYPE_BY_ORDINAL[type] ?? 'UNKNOWN'
  return type.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const DB_TYPE_LABELS: Record<string, string> = {
  POSTGRES: 'Postgres',
  CLICKHOUSE: 'ClickHouse',
  MYSQL: 'MySQL',
  MONGO: 'MongoDB',
  KAFKA: 'Kafka',
  EVENTHUB: 'Event Hubs',
  S3: 'S3',
  BIGQUERY: 'BigQuery',
  SNOWFLAKE: 'Snowflake',
  ELASTICSEARCH: 'Elasticsearch',
  PUBSUB: 'Pub/Sub',
  SQLSERVER: 'SQL Server',
}

export function dbTypeLabel(type?: DBType): string {
  const key = normalizeDbType(type)
  return DB_TYPE_LABELS[key] ?? (key === 'UNKNOWN' ? 'Unknown' : key)
}

/** Human-friendly mirror status label (drops the STATUS_ prefix, title-cases). */
export function statusLabel(status?: FlowStatus): string {
  if (!status) return 'Unknown'
  const bare = status.replace(/^STATUS_/, '')
  return bare.charAt(0) + bare.slice(1).toLowerCase()
}

export type StatusTone = 'running' | 'paused' | 'failed' | 'progress' | 'idle'

/** Coarse tone for a mirror status, used to pick badge/edge colors. */
export function statusTone(status?: FlowStatus): StatusTone {
  switch (status) {
    case 'STATUS_RUNNING':
      return 'running'
    case 'STATUS_PAUSED':
    case 'STATUS_PAUSING':
      return 'paused'
    case 'STATUS_FAILED':
    case 'STATUS_TERMINATING':
    case 'STATUS_TERMINATED':
      return 'failed'
    case 'STATUS_SETUP':
    case 'STATUS_SNAPSHOT':
      return 'progress'
    default:
      return 'idle'
  }
}

/** Hex color per tone — used for React Flow edges (inline SVG styles). */
export const TONE_COLOR: Record<StatusTone, string> = {
  running: '#22c55e', // green-500
  paused: '#f59e0b', // amber-500
  failed: '#ef4444', // red-500
  progress: '#3b82f6', // blue-500
  idle: '#94a3b8', // slate-400
}

/** Milliseconds between two ISO timestamps, or null when not computable. */
export function durationMs(start?: string, end?: string): number | null {
  if (!start || !end) return null
  const s = Date.parse(start)
  const e = Date.parse(end)
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  return Math.max(0, e - s)
}

export function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : 0
}

/**
 * Largest-Triangle-Three-Buckets downsample. Reduces a numeric series to at
 * most `threshold` points while preserving visual shape (peaks/troughs), so a
 * chart fed thousands of points renders a bounded number of SVG nodes.
 * Returns the input unchanged when already small enough.
 */
export function downsample(data: number[], threshold: number): number[] {
  const n = data.length
  if (threshold >= n || threshold < 3) {
    const allowed = Math.min(threshold, n)
    return data.slice(0, allowed)
  }

  const sampled: number[] = [data[0]]
  const bucketSize = (n - 2) / (threshold - 2)
  let a = 0

  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * bucketSize) + 1
    const avgEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n)
    let avgX = 0
    let avgY = 0
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += j
      avgY += data[j]
    }
    const avgCount = avgEnd - avgStart || 1
    avgX /= avgCount
    avgY /= avgCount

    const rangeStart = Math.floor(i * bucketSize) + 1
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1
    const ay = data[a]
    let maxArea = -1
    let nextA = rangeStart
    let pickedValue = data[rangeStart]
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area =
        Math.abs((a - avgX) * (data[j] - ay) - (a - j) * (avgY - ay)) * 0.5
      if (area > maxArea) {
        maxArea = area
        nextA = j
        pickedValue = data[j]
      }
    }
    sampled.push(pickedValue)
    a = nextA
  }

  sampled.push(data[n - 1])
  return sampled
}

/**
 * Bucket an (x,y) series down to at most `maxBars` bars by summing adjacent
 * groups, keeping the first label of each group. Used by the partition
 * sync-history chart so long histories stay legible and cheap to render.
 */
export function bucketSeries(
  data: { x: string; y: number }[],
  maxBars: number
): { x: string; y: number }[] {
  if (maxBars < 1 || data.length <= maxBars) {
    const allowed = Math.min(maxBars, data.length)
    return data.slice(0, allowed)
  }
  const groupSize = Math.ceil(data.length / maxBars)
  const out: { x: string; y: number }[] = []
  for (let i = 0; i < data.length; i += groupSize) {
    const group = data.slice(i, i + groupSize)
    out.push({
      x: group[0].x,
      y: group.reduce((s, d) => s + d.y, 0),
    })
  }
  return out
}

/** Format an ISO-8601 timestamp for display; falls back to the raw string. */
export function formatDateTime(
  iso?: string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  if (iso == null || iso === '') return '—'
  const t = parseTs(iso)
  return t == null
    ? String(iso)
    : new Date(t).toLocaleString(undefined, options)
}

/**
 * True when an SWR error means PeerDB is unconfigured (proxy returns 503).
 * Centralizes the not-configured signal so pages don't hard-code the status.
 */
export function isPeerDBNotConfigured(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 503
}

// ─────────────────────── design-spec formatting (CHM Redesign) ───────────────────────

/**
 * Compact count: 1.2K / 3.4M / 1.23B / 2.10T.
 *
 * Note: intentionally separate from formatCompactNumber (lib/format-readable.ts) due to
 * different thresholds (adds T tier) and sub-1000 formatting (toLocaleString).
 * Do not merge without design sign-off.
 */
export function pdbFmtNum(n?: number | null): string {
  if (n == null) return '—'
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Math.round(n).toLocaleString()
}

/** WAL/slot size from MiB → "18.4 MiB" / "4.08 GiB". */
export function pdbFmtBytes(mib?: number | null): string {
  if (mib == null) return '—'
  if (mib >= 1024) return `${(mib / 1024).toFixed(2)} GiB`
  return `${mib.toFixed(1)} MiB`
}

/** Replication lag seconds → "820 ms" / "3.2 s" / "2m 1s" / "23h 22m". */
export function pdbFmtLag(s?: number | null): string {
  if (s == null) return '—'
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`
  if (s < 60) return `${s.toFixed(1)} s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  if (s < 86400)
    return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.round((s % 86400) / 3600)}h`
}

/** Partition duration seconds → "42.3s" / "1m 4s". */
export function pdbFmtDuration(s?: number | null): string {
  if (s == null) return '—'
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

/**
 * Parse a timestamp to epoch ms, accepting ISO strings, epoch-ms numbers, and
 * epoch-seconds/ms numeric strings (PeerDB serializes timestamps inconsistently
 * across endpoints/versions). Returns null when unparseable.
 */
export function parseTs(value?: string | number | null): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // < 1e11 (100 billion) is epoch seconds, otherwise epoch milliseconds.
    // Using 1e11 avoids misclassifying epoch-ms timestamps before ~2001.
    return value < 1e11 ? value * 1000 : value
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    // < 1e11 (100 billion) is epoch seconds, otherwise epoch milliseconds.
    return n < 1e11 ? n * 1000 : n
  }
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

/** ISO/epoch → "HH:MM:SSZ" clock (UTC), used in the partitions table + logs. */
export function pdbFmtClock(iso?: string | number): string {
  const t = parseTs(iso)
  if (t == null) return '—'
  return `${new Date(t).toISOString().substring(11, 19)}Z`
}

/**
 * Compact age "5d 8h" / "4h 12m" / "38m" (design's `createdAgo`). Accepts an
 * ISO string, epoch ms, or epoch seconds — PeerDB versions vary in how the
 * `createdAt` timestamp is serialized.
 */
export function pdbFmtAgo(value?: string | number): string {
  if (value == null || value === '') return '—'
  const t = parseTs(value)
  if (t == null) return '—'
  const sec = Math.max(0, (Date.now() - t) / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** The design's 4-state status model. */
export type DesignStatus = 'running' | 'snapshotting' | 'paused' | 'failed'

/** Map a PeerDB FlowStatus to the design's status key. */
export function toDesignStatus(status?: FlowStatus): DesignStatus {
  switch (status) {
    case 'STATUS_RUNNING':
      return 'running'
    case 'STATUS_SETUP':
    case 'STATUS_SNAPSHOT':
      return 'snapshotting'
    case 'STATUS_PAUSING':
    case 'STATUS_PAUSED':
      return 'paused'
    default:
      return 'failed'
  }
}

export interface DesignStatusMeta {
  label: string
  dot: string
  pulse: boolean
}

/** Status pill/dot colors, verbatim from the design's STATUS_META. */
export const DESIGN_STATUS_META: Record<DesignStatus, DesignStatusMeta> = {
  running: { label: 'Running', dot: '#10b981', pulse: true },
  snapshotting: { label: 'Snapshotting', dot: '#3b82f6', pulse: true },
  paused: { label: 'Paused', dot: '#f59e0b', pulse: false },
  failed: { label: 'Failed', dot: '#f43f5e', pulse: false },
}

export interface PeerKind {
  label: string
  mono: string
  fg: string
  bg: string
  dot: string
}

/** Peer-type vocabulary (monogram chips), verbatim from the design's PEER_KINDS. */
export const PEER_KINDS: Record<string, PeerKind> = {
  POSTGRES: {
    label: 'Postgres',
    mono: 'PG',
    fg: '#1e3a8a',
    bg: '#dbeafe',
    dot: '#3b82f6',
  },
  MYSQL: {
    label: 'MySQL',
    mono: 'MY',
    fg: '#155e75',
    bg: '#cffafe',
    dot: '#06b6d4',
  },
  CLICKHOUSE: {
    label: 'ClickHouse',
    mono: 'CH',
    fg: '#854d0e',
    bg: '#fef3c7',
    dot: '#f59e0b',
  },
  MONGO: {
    label: 'MongoDB',
    mono: 'MG',
    fg: '#14532d',
    bg: '#dcfce7',
    dot: '#10b981',
  },
  KAFKA: {
    label: 'Kafka',
    mono: 'KF',
    fg: '#1c1917',
    bg: '#e7e5e4',
    dot: '#525252',
  },
  S3: { label: 'S3', mono: 'S3', fg: '#7c2d12', bg: '#ffedd5', dot: '#f97316' },
  SNOWFLAKE: {
    label: 'Snowflake',
    mono: 'SN',
    fg: '#0c4a6e',
    bg: '#e0f2fe',
    dot: '#0ea5e9',
  },
  BIGQUERY: {
    label: 'BigQuery',
    mono: 'BQ',
    fg: '#1e40af',
    bg: '#dbeafe',
    dot: '#2563eb',
  },
  ELASTICSEARCH: {
    label: 'Elastic',
    mono: 'ES',
    fg: '#365314',
    bg: '#ecfccb',
    dot: '#84cc16',
  },
  EVENTHUB: {
    label: 'Event Hubs',
    mono: 'EH',
    fg: '#3730a3',
    bg: '#e0e7ff',
    dot: '#6366f1',
  },
  PUBSUB: {
    label: 'Pub/Sub',
    mono: 'PS',
    fg: '#3730a3',
    bg: '#e0e7ff',
    dot: '#6366f1',
  },
  UNKNOWN: {
    label: 'Unknown',
    mono: '??',
    fg: '#3f3f46',
    bg: '#e4e4e7',
    dot: '#71717a',
  },
}

/** Resolve a peer kind from a PeerDB DBType (string name or numeric ordinal). */
export function peerKind(type?: DBType): PeerKind {
  return PEER_KINDS[normalizeDbType(type)] ?? PEER_KINDS.UNKNOWN
}

// ─────────────────────── pipeline phase flow ───────────────────────

export interface PhaseNode {
  id: string
  label: string
  hint: string
}

/** Phase node sequences per mirror type (verbatim from the design PHASE_FLOWS). */
export const PHASE_FLOWS: Record<'CDC' | 'QRep', PhaseNode[]> = {
  CDC: [
    { id: 'setup', label: 'Setup', hint: 'Slot · publication · table init' },
    {
      id: 'initial_snapshot',
      label: 'Initial snapshot',
      hint: 'Backfill existing rows',
    },
    { id: 'snapshot_done', label: 'Snapshot done', hint: 'Backfill complete' },
    {
      id: 'cdc_running',
      label: 'CDC streaming',
      hint: 'Tailing WAL / binlog · ongoing',
    },
  ],
  QRep: [
    { id: 'setup', label: 'Setup', hint: 'Validate watermark column' },
    {
      id: 'partition_planning',
      label: 'Partition planning',
      hint: 'Compute watermark ranges',
    },
    {
      id: 'partitions_running',
      label: 'Replicating partitions',
      hint: 'Streaming partition batches',
    },
    {
      id: 'snapshot_done',
      label: 'Complete',
      hint: 'All partitions replicated',
    },
  ],
}

export type PhaseMode = 'progress' | 'paused' | 'failed'

/**
 * Resolve a mirror's position on its phase flow from FlowStatus + type.
 * Paused/failed mirrors freeze at their last known progress phase; the current
 * node is colored by mode (amber/rose).
 */
export function resolveMirrorPhase(
  status: FlowStatus | undefined,
  isCdc: boolean
): { nodes: PhaseNode[]; currentIdx: number; mode: PhaseMode } {
  const nodes = isCdc ? PHASE_FLOWS.CDC : PHASE_FLOWS.QRep
  const ds = toDesignStatus(status)
  let phaseId: string
  if (status === 'STATUS_SETUP') phaseId = 'setup'
  else if (ds === 'snapshotting')
    phaseId = isCdc ? 'initial_snapshot' : 'partitions_running'
  else phaseId = isCdc ? 'cdc_running' : 'snapshot_done' // running/paused/failed
  if ((ds === 'paused' || ds === 'failed') && !isCdc)
    phaseId = 'partitions_running'
  let currentIdx = nodes.findIndex((n) => n.id === phaseId)
  if (currentIdx < 0) currentIdx = 0
  const mode: PhaseMode =
    ds === 'failed' ? 'failed' : ds === 'paused' ? 'paused' : 'progress'
  return { nodes, currentIdx, mode }
}

// ─────────────────────── mirror logs ───────────────────────

export interface LogLevelMeta {
  label: string
  dot: string
}

/** Log-level pill colors (design LOG_LEVEL_META). */
export const LOG_LEVEL_META: Record<string, LogLevelMeta> = {
  error: { label: 'ERROR', dot: '#f43f5e' },
  warn: { label: 'WARN', dot: '#f59e0b' },
  info: { label: 'INFO', dot: '#3b82f6' },
}

/**
 * Normalize a PeerDB log `errorType` to a canonical level. PeerDB is not
 * consistent about casing (`ERROR`, `WARNING`, `warn`), so fold to lowercase
 * and collapse the `warning` synonym before matching tabs/colors.
 *
 * Single implementation lives in `@/lib/peerdb/mirror-logs` (shared with the
 * alert lane); this wrapper keeps existing imports working.
 */
export function normalizePdbLogLevel(
  errorType?: string | null
): 'error' | 'warn' | 'info' {
  return normalizeLogLevel(errorType)
}

/** Relative "Ns ago / Nm ago / Nh ago" from an ISO timestamp. */
export function pdbFmtRelative(iso?: string | number): string {
  const t = parseTs(iso)
  if (t == null) return '—'
  const diff = Math.max(0, Date.now() - t)
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}
