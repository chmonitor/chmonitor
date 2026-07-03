/**
 * Inbound event normalization — source detection + reduction to the common
 * {@link NormalizedEvent} schema, plus the dedup content hash.
 *
 * Never throws: inbound payloads are attacker/vendor-suppliable JSON, so every
 * field access goes through the `asRecord`/`asString` guards below and falls
 * back to a generic shape rather than raising. See
 * plans/36-inbound-event-bus-queues.md.
 */

import type { EventSeverity, EventSource, NormalizedEvent } from './types'

// ---------------------------------------------------------------------------
// Small parsing guards (untrusted JSON in, never throw)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Coerce a plain object's values to strings, dropping non-primitives. */
function toStringLabels(
  record: Record<string, unknown>
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') labels[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') {
      labels[key] = String(value)
    }
  }
  return labels
}

/** Datadog `tags` is either `"env:prod,service:api"` or `["env:prod", ...]`. */
function parseDatadogTags(tags: unknown): Record<string, string> {
  const list = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === 'string')
    : typeof tags === 'string'
      ? tags.split(',')
      : []
  const labels: Record<string, string> = {}
  for (const tag of list) {
    const idx = tag.indexOf(':')
    if (idx <= 0) continue
    const key = tag.slice(0, idx).trim()
    const value = tag.slice(idx + 1).trim()
    if (key && value) labels[key] = value
  }
  return labels
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

const CRITICAL_ALIASES = new Set([
  'critical',
  'crit',
  'error',
  'fatal',
  'p1',
  'sev1',
  'page',
])
const INFO_ALIASES = new Set([
  'info',
  'informational',
  'ok',
  'resolved',
  'recovery',
  'success',
  'notice',
])

/** Unrecognized/missing severity defaults to `warning` — a real signal
 * shouldn't silently downgrade to `info`, and not everything is `critical`. */
function normalizeSeverity(raw: unknown): EventSeverity {
  if (typeof raw !== 'string') return 'warning'
  const key = raw.trim().toLowerCase()
  if (CRITICAL_ALIASES.has(key)) return 'critical'
  if (INFO_ALIASES.has(key)) return 'info'
  return 'warning'
}

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

/**
 * Detect the source shape of an inbound payload. Alertmanager webhook
 * payloads carry `alerts: [...]` + `commonLabels`; Datadog monitor-webhook
 * payloads carry `alert_type` + `aggreg_key`. Anything else is `generic`.
 */
export function detectSource(payload: unknown): EventSource {
  const record = asRecord(payload)
  if (!record) return 'generic'

  if (Array.isArray(record.alerts) && asRecord(record.commonLabels)) {
    return 'alertmanager'
  }

  if (
    typeof record.alert_type === 'string' &&
    typeof record.aggreg_key === 'string'
  ) {
    return 'datadog'
  }

  return 'generic'
}

type UnhashedEvent = Omit<NormalizedEvent, 'dedupHash'>

function normalizeAlertmanager(
  record: Record<string, unknown>,
  receivedAt: number
): UnhashedEvent {
  const alerts = Array.isArray(record.alerts) ? record.alerts : []
  const firstAlert = asRecord(alerts[0]) ?? {}
  const commonLabels = asRecord(record.commonLabels) ?? {}
  const firstLabels = asRecord(firstAlert.labels) ?? {}
  const commonAnnotations = asRecord(record.commonAnnotations) ?? {}
  const firstAnnotations = asRecord(firstAlert.annotations) ?? {}

  // Prefer commonLabels (shared by every alert in the group); fall back to
  // the first alert's own labels for single-alert groups with sparse commons.
  const labels =
    Object.keys(commonLabels).length > 0 ? commonLabels : firstLabels
  const status = asString(record.status) ?? asString(firstAlert.status)

  const title = asString(labels.alertname) ?? 'Alertmanager event'
  const resource =
    asString(labels.instance) ?? asString(labels.job) ?? 'unknown'
  // A "resolved" notification is a recovery, not a fresh alert — normalize to
  // `info` regardless of the label's severity so it reads as a clear.
  const severity: EventSeverity =
    status === 'resolved' ? 'info' : normalizeSeverity(labels.severity)
  const body =
    asString(commonAnnotations.description) ??
    asString(commonAnnotations.summary) ??
    asString(firstAnnotations.description) ??
    asString(firstAnnotations.summary) ??
    null

  return {
    id: crypto.randomUUID(),
    source: 'alertmanager',
    severity,
    resource,
    title,
    body,
    labels: toStringLabels(labels),
    receivedAt,
  }
}

function normalizeDatadog(
  record: Record<string, unknown>,
  receivedAt: number
): UnhashedEvent {
  const tagLabels = parseDatadogTags(record.tags)
  const alertType = asString(record.alert_type)
  const aggregKey = asString(record.aggreg_key)

  const title = asString(record.title) ?? 'Datadog event'
  const resource =
    asString(record.hostname) ?? tagLabels.host ?? aggregKey ?? 'unknown'
  const severity = normalizeSeverity(alertType)
  const body = asString(record.text) ?? asString(record.body) ?? null

  const labels: Record<string, string> = { ...tagLabels }
  if (alertType) labels.alert_type = alertType
  if (aggregKey) labels.aggreg_key = aggregKey

  return {
    id: crypto.randomUUID(),
    source: 'datadog',
    severity,
    resource,
    title,
    body,
    labels,
    receivedAt,
  }
}

function normalizeGeneric(
  record: Record<string, unknown>,
  receivedAt: number
): UnhashedEvent {
  const title =
    asString(record.title) ??
    asString(record.summary) ??
    truncate(asString(record.message), 120) ??
    'Event'
  const resource =
    asString(record.resource) ??
    asString(record.host) ??
    asString(record.instance) ??
    'unknown'
  const severity = normalizeSeverity(record.severity)
  const body =
    asString(record.body) ??
    asString(record.message) ??
    asString(record.description) ??
    null
  const rawLabels = asRecord(record.labels) ?? {}

  return {
    id: crypto.randomUUID(),
    source: 'generic',
    severity,
    resource,
    title,
    body,
    labels: toStringLabels(rawLabels),
    receivedAt,
  }
}

// ---------------------------------------------------------------------------
// Dedup hash
// ---------------------------------------------------------------------------

/**
 * Content hash of `(source, resource, title, severity)` — the D1 upsert key.
 * Two payloads that normalize to the same 4-tuple hash identically, so a
 * repeat within the retention window bumps `count`/`last_seen` on the same
 * row instead of inserting a duplicate. A severity *change* (e.g.
 * warning→critical) therefore produces a new row by design — it reads as a
 * distinct escalation entry in the Inbound Events feed rather than silently
 * overwriting the prior severity.
 */
export async function computeDedupHash(
  parts: Pick<NormalizedEvent, 'source' | 'resource' | 'title' | 'severity'>
): Promise<string> {
  const key = [parts.source, parts.resource, parts.title, parts.severity].join(
    ' '
  )
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key)
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Normalize an arbitrary inbound payload into the common {@link NormalizedEvent}
 * schema. Never throws — malformed/unexpected input degrades to the generic
 * shape rather than raising, since payloads are external and untrusted.
 */
export async function normalizeEvent(
  payload: unknown,
  receivedAt: number = Date.now()
): Promise<NormalizedEvent> {
  const source = detectSource(payload)
  const record = asRecord(payload) ?? {}

  const base =
    source === 'alertmanager'
      ? normalizeAlertmanager(record, receivedAt)
      : source === 'datadog'
        ? normalizeDatadog(record, receivedAt)
        : normalizeGeneric(record, receivedAt)

  const dedupHash = await computeDedupHash(base)
  return { ...base, dedupHash }
}
