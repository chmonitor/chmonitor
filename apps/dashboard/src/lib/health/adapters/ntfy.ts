/**
 * ntfy notification adapter (pure formatter).
 *
 * ntfy (https://ntfy.sh / self-hosted) publishes a push notification by POSTing
 * to a topic URL (`<server>/<topic>`) with the message as the plain-text body
 * and a small set of control headers:
 *
 *   - `Title`    — the notification title
 *   - `Priority` — 1 (min) … 5 (max/urgent)
 *   - `Tags`     — comma-separated emoji shortcodes / labels
 *   - `Authorization: Bearer <token>` — optional, for protected topics
 *
 * This module only SHAPES those headers + body from an {@link AlertPayload};
 * the caller (dispatch layer) owns the topic URL, the token, and the actual
 * `fetch`. Pure — no network, no side effects — so it is trivially unit-tested,
 * mirroring `adapters/telegram.ts`.
 *
 * Severity → priority/tag mapping (per issue #2657):
 *   critical → priority 5 (urgent), 🚨 tag
 *   warning  → priority 4 (high),   ⚠️ tag
 *   recovery → priority 3 (default), ✅ tag
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Severity → ntfy priority (`1`–`5`). Higher = more urgent. */
const SEVERITY_PRIORITY: Record<AlertSeverity, '3' | '4' | '5'> = {
  critical: '5',
  warning: '4',
  recovery: '3',
}

/**
 * Severity → ntfy tag (emoji shortcode). Recovery carries the check-mark the
 * issue asks for; critical/warning get a siren/warning glyph so the phone
 * notification is scannable at a glance.
 */
const SEVERITY_TAG: Record<AlertSeverity, string> = {
  critical: 'rotating_light',
  warning: 'warning',
  recovery: 'white_check_mark',
}

/**
 * Strip a value down to what is safe in an HTTP header (printable ASCII).
 *
 * Header values must be Latin-1 with no control characters; `fetch` throws on
 * anything outside that range. The `Title` header can carry a caller-derived
 * string (rule title), so we drop control chars and any code point above
 * `0x7e`, collapsing runs of whitespace — the full, UTF-8-safe detail always
 * lives in the plain-text body instead.
 */
export function sanitizeHeaderValue(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code <= 0x7e) out += ch
    else out += ' '
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** The rendered ntfy message: control fields + plain-text body. */
export interface NtfyMessage {
  /** `Title` header — `[SEVERITY] <alert title>`. */
  title: string
  /** `Priority` header — `'3'` | `'4'` | `'5'`. */
  priority: '3' | '4' | '5'
  /** `Tags` header — comma-separated. */
  tags: string
  /** Plain-text message body (UTF-8 safe). */
  body: string
}

/** Caller-supplied ntfy transport config. */
export interface NtfyConfig {
  /** Full topic URL, e.g. `https://ntfy.sh/my-topic`. */
  url: string
  /** Optional access token for a protected topic (`Authorization: Bearer …`). */
  token?: string
}

/** `RECOVERY` for a resolved incident, otherwise the uppercased severity. */
function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
}

/**
 * Build the ntfy message (title/priority/tags/body) for a payload. Exported so
 * tests and the dispatch layer can assert the rendered shape independent of the
 * header wrapper.
 */
export function buildNtfyMessage(payload: AlertPayload): NtfyMessage {
  const lines: string[] = [
    `Host: ${payload.hostLabel} (id ${payload.hostId})`,
    `Metric: ${payload.metric}`,
    `Value: ${payload.value === null ? 'n/a' : payload.value}`,
  ]

  const thresholds: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    thresholds.push(`warn ${payload.warnThreshold}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    thresholds.push(`crit ${payload.critThreshold}`)
  }
  if (thresholds.length > 0) {
    lines.push(`Thresholds: ${thresholds.join(' | ')}`)
  }

  lines.push(`Detail: ${payload.label}`)

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    lines.push('')
    lines.push('Runbooks:')
    for (const url of payload.runbookUrls) lines.push(`- ${url}`)
  }

  lines.push('')
  lines.push(payload.timestamp)

  return {
    title: `[${heading(payload.severity)}] ${payload.title}`,
    priority: SEVERITY_PRIORITY[payload.severity],
    tags: SEVERITY_TAG[payload.severity],
    body: lines.join('\n'),
  }
}

/**
 * Build the outbound HTTP headers for an ntfy publish. `Title` is sanitized to
 * header-safe ASCII (the body keeps the full UTF-8 text); `Authorization` is
 * added only when a token is supplied.
 */
export function buildNtfyHeaders(
  payload: AlertPayload,
  token?: string
): Record<string, string> {
  const message = buildNtfyMessage(payload)
  const headers: Record<string, string> = {
    Title: sanitizeHeaderValue(message.title),
    Priority: message.priority,
    Tags: message.tags,
    'Content-Type': 'text/plain; charset=utf-8',
  }
  const trimmedToken = token?.trim()
  if (trimmedToken) headers.Authorization = `Bearer ${trimmedToken}`
  return headers
}

/**
 * ntfy adapter. `buildBody` returns the plain-text body only — ntfy's control
 * fields (title/priority/tags) travel as HTTP headers via
 * {@link buildNtfyHeaders}, not in the body, so the dispatch layer uses those
 * two helpers directly. Deliberately NOT registered in `ADAPTERS` (see
 * `adapters/index.ts`): ntfy is selected by env/route config, and its
 * header-driven publish can't ride the generic `{ text, content }` proxy path.
 */
export const ntfyAdapter: NotificationAdapter = {
  id: 'ntfy',
  buildBody: (payload: AlertPayload) => buildNtfyMessage(payload).body,
}
