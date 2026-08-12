/**
 * Pluggable persistence for AI Insights.
 *
 * AI Insights are persisted as *findings* — short, structured records of
 * something noteworthy on a cluster (see `lib/findings/findings-store.ts` for
 * the original ClickHouse-only implementation). This module abstracts that
 * persistence behind a small `InsightsStore` interface so the storage backend
 * can be selected at deploy time — exactly like the AI agent's pluggable
 * `ConversationStore` (`lib/conversation-store/`).
 *
 * Why this exists: the original engine wrote insights straight to a ClickHouse
 * table on the monitored cluster. On a read-only monitoring connection that
 * write silently fails, so insights never survive a reload. Letting operators
 * point persistence at D1 / Postgres / AgentState fixes that without giving the
 * monitoring user write access to the cluster it watches.
 *
 * Every method is **best-effort**: a backend that cannot write (read-only
 * cluster, missing binding) logs and returns `false`/`[]` rather than throwing,
 * so both the manual "Generate" endpoint and the cron sweep stay resilient.
 *
 * The interface intentionally reuses the `Finding` / `FindingRow` /
 * `ListFindingsOptions` shapes from the findings store so the read path
 * (`read-insights.ts` → `toCard`) is identical regardless of backend.
 */

import type {
  Finding,
  FindingRow,
  ListFindingsOptions,
} from '@/lib/findings/findings-store'

export type {
  Finding,
  FindingRow,
  FindingSeverity,
  ListFindingsOptions,
} from '@/lib/findings/findings-store'

/**
 * Identifiers for the supported insight storage backends.
 *
 * - `clickhouse` — app-owned table on the monitored cluster (default, current
 *   behavior). Requires a writable monitoring connection.
 * - `d1`         — Cloudflare D1 (reuses the conversation D1 binding).
 * - `postgres`   — PostgreSQL via `DATABASE_URL`.
 * - `agentstate` — AgentState generic State store (https://agentstate.app).
 * - `memory`     — in-process map; ephemeral, last-resort fallback.
 */
export type InsightsBackendKind =
  | 'clickhouse'
  | 'd1'
  | 'postgres'
  | 'agentstate'
  | 'memory'

/**
 * Storage adapter for AI Insights.
 *
 * All backends implement this. `record` persists a batch (the engine produces
 * several insights per run); `list` reads recent findings newest-first so the
 * read path can de-duplicate by stable key.
 */
export interface InsightsStore {
  /** Which backend this instance is — surfaced read-only in the UI. */
  readonly backend: InsightsBackendKind

  /**
   * Persist a batch of findings for a host. Best-effort: returns `true` only
   * when every finding was written, `false` if any write failed or the backend
   * is unavailable. Never throws.
   */
  record(hostId: number, findings: Finding[]): Promise<boolean>

  /**
   * Read recent findings for a host, newest first. Best-effort: returns `[]` if
   * the backing store is missing or unreadable. Never throws.
   */
  list(hostId: number, opts?: ListFindingsOptions): Promise<FindingRow[]>
}

/**
 * Map a `Finding` (write shape, scalar-only) plus a host id and timestamp into
 * the `FindingRow` read shape shared by every backend. Centralized so the
 * non-ClickHouse adapters stay consistent with the ClickHouse column contract.
 */
export function toFindingRow(
  hostId: number,
  finding: Finding,
  eventTime: string
): FindingRow {
  return {
    event_time: eventTime,
    host_id: String(hostId),
    severity: finding.severity,
    category: finding.category,
    source: finding.source,
    title: finding.title,
    detail: finding.detail ?? '',
    metric: finding.metric ?? '',
    value: finding.value ?? 0,
  }
}

/**
 * Clamp a caller-supplied row limit into the supported `[1, 1000]` range,
 * defaulting when unset. Shared by every backend so the page-size policy lives
 * in one place rather than being copy-pasted per adapter.
 */
export function clampLimit(limit: number | undefined, fallback = 100): number {
  const n = Math.trunc(limit ?? fallback)
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : fallback
}

/** Loose shape of a row read back from a DB-backed store before normalization. */
export interface StoredFindingRow {
  /** Unix epoch milliseconds (or anything `Number()`-coercible to it). */
  event_time?: unknown
  host_id?: unknown
  severity?: unknown
  category?: unknown
  source?: unknown
  title?: unknown
  detail?: unknown
  metric?: unknown
  value?: unknown
}

/**
 * Convert a stored backend row (numeric `event_time` in ms, possibly
 * string-typed `value` from the driver) into the canonical `FindingRow` read
 * shape. The inverse of {@link toFindingRow}'s write mapping — centralized so
 * the D1 / Postgres / AgentState read paths cannot drift on the
 * ms→ISO / value→number contract. Defensive coercion keeps a malformed field
 * from throwing.
 */
export function rowFromStored(s: StoredFindingRow): FindingRow {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const num = (v: unknown): number =>
    typeof v === 'number' ? v : Number(v) || 0
  return {
    event_time: new Date(num(s.event_time)).toISOString(),
    host_id: str(s.host_id),
    severity: str(s.severity),
    category: str(s.category),
    source: str(s.source),
    title: str(s.title),
    detail: str(s.detail),
    metric: str(s.metric),
    value: num(s.value),
  }
}
