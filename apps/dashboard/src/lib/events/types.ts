/**
 * Shared types for the inbound event bus (Alertmanager / Datadog / generic
 * webhook → normalize → dedup → D1 `event_log`, ~30d retention, optional
 * re-emit). See plans/36-inbound-event-bus-queues.md.
 */

export type EventSource = 'alertmanager' | 'datadog' | 'generic'

export type EventSeverity = 'critical' | 'warning' | 'info'

export interface NormalizedEvent {
  id: string
  source: EventSource
  severity: EventSeverity
  resource: string
  title: string
  body: string | null
  labels: Record<string, string>
  receivedAt: number
  /**
   * Content hash of `(source, resource, title, severity)` — the D1 upsert
   * key. Two payloads that normalize to the same 4-tuple collapse to one row
   * (count/last_seen bump) rather than duplicating.
   */
  dedupHash: string
}

export interface StoredEvent extends NormalizedEvent {
  count: number
  lastSeen: number
}
