/**
 * Shared types for the inbound event bus (Alertmanager / Datadog / generic
 * webhook → normalize → dedup → D1 `event_log`, ~30d retention, optional
 * re-emit). See plans/36-inbound-event-bus-queues.md.
 */

/** Sources {@link normalizeEvent} knows how to detect and normalize. */
export type EventSource = 'alertmanager' | 'datadog' | 'generic'

/** Normalized severity. `info` also covers Alertmanager/Datadog "resolved". */
export type EventSeverity = 'critical' | 'warning' | 'info'

/**
 * Common shape every inbound event source is reduced to by
 * {@link file://./normalize.ts}.
 */
export interface NormalizedEvent {
  /** Stable id for this occurrence (first-seen). NOT the dedup/upsert key. */
  id: string
  source: EventSource
  severity: EventSeverity
  /** The alerting resource this event is about (instance/host/service). */
  resource: string
  title: string
  body: string | null
  /** Arbitrary label bag from the source payload, kept for filtering/debug. */
  labels: Record<string, string>
  receivedAt: number
  /**
   * Content hash of `(source, resource, title, severity)` — the D1 upsert
   * key. Two payloads that normalize to the same 4-tuple collapse to one row
   * (count/last_seen bump) rather than duplicating.
   */
  dedupHash: string
}

/** A persisted `event_log` row: {@link NormalizedEvent} + upsert bookkeeping. */
export interface StoredEvent extends NormalizedEvent {
  /** Number of occurrences collapsed into this row (including the first). */
  count: number
  /** Timestamp (ms) of the most recent occurrence. */
  lastSeen: number
}
