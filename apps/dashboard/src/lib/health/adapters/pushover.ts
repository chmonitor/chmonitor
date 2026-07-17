/**
 * Pushover notification adapter (pure formatter).
 *
 * Pushover (https://pushover.net) delivers a push notification by POSTing to
 * the fixed Messages API endpoint
 * (`https://api.pushover.net/1/messages.json`) with `token` (the application
 * API token) and `user` (the target user/group key) plus the message fields.
 * Pushover accepts either a form-encoded or a JSON-encoded body (see
 * https://pushover.net/api) — this module uses JSON, mirroring
 * `adapters/telegram.ts`.
 *
 * This module only SHAPES the message fields from an {@link AlertPayload};
 * the caller (dispatch layer) owns `token`/`user` and the actual `fetch`.
 * Pure — no network, no side effects — so it is trivially unit-tested,
 * mirroring `adapters/ntfy.ts` / `adapters/telegram.ts`.
 *
 * Severity → priority mapping (per issue #2659):
 *   critical → priority 2 (emergency — requires ack, retried until it expires)
 *   warning  → priority 0 (normal)
 *   recovery → priority -1 (low — quiet, no sound/vibration)
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Severity → Pushover priority (`-1` low, `0` normal, `2` emergency). */
const SEVERITY_PRIORITY: Record<AlertSeverity, '-1' | '0' | '2'> = {
  critical: '2',
  warning: '0',
  recovery: '-1',
}

/**
 * Emergency-priority (2) retry/expire, in seconds — REQUIRED by the Pushover
 * API whenever `priority` is `2` (it 400s without them). Retries the
 * notification every 60s, for up to 1 hour, until the operator acknowledges
 * it — sane defaults for a monitoring alert (Pushover's own limits: `retry`
 * >= 30s, `expire` <= 10800s/3h).
 */
const EMERGENCY_RETRY_SECONDS = '60'
const EMERGENCY_EXPIRE_SECONDS = '3600'

/** Caller-supplied Pushover transport config. */
export interface PushoverConfig {
  /** Application API token. */
  token: string
  /** Target user or group key. */
  user: string
}

/** The rendered Pushover message fields (excludes `token`/`user`). */
export interface PushoverMessage {
  title: string
  message: string
  priority: '-1' | '0' | '2'
  /** Unix timestamp (seconds), matching the Pushover API's `timestamp` field. */
  timestamp: number
  /** Required alongside `priority: '2'` — resend interval, in seconds. */
  retry?: string
  /** Required alongside `priority: '2'` — how long Pushover keeps retrying. */
  expire?: string
  /** Optional supplementary URL (first runbook link, when present). */
  url?: string
}

/** Body shape for the Pushover Messages API (`token`/`user` + the message). */
export interface PushoverMessageBody extends PushoverMessage {
  token: string
  user: string
}

/** `RECOVERY` for a resolved incident, otherwise the uppercased severity. */
function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
}

/**
 * Build the Pushover message fields (title/message/priority/…) for a
 * payload. Exported so tests and the dispatch layer can assert the rendered
 * shape independent of the `token`/`user` wrapper.
 */
export function buildPushoverMessage(payload: AlertPayload): PushoverMessage {
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

  const priority = SEVERITY_PRIORITY[payload.severity]
  const parsedMs = Date.parse(payload.timestamp)
  const timestamp = Number.isFinite(parsedMs)
    ? Math.floor(parsedMs / 1000)
    : Math.floor(Date.now() / 1000)

  return {
    title: `[${heading(payload.severity)}] ${payload.title}`,
    message: lines.join('\n'),
    priority,
    timestamp,
    ...(priority === '2'
      ? { retry: EMERGENCY_RETRY_SECONDS, expire: EMERGENCY_EXPIRE_SECONDS }
      : {}),
    ...(payload.runbookUrls?.[0] ? { url: payload.runbookUrls[0] } : {}),
  }
}

/**
 * Build the full Pushover Messages API request body: `token` + `user` plus
 * the rendered message fields.
 */
export function buildPushoverBody(
  payload: AlertPayload,
  config: PushoverConfig
): PushoverMessageBody {
  return {
    token: config.token,
    user: config.user,
    ...buildPushoverMessage(payload),
  }
}

/**
 * Pushover adapter. `buildBody` returns the message fields only — `token`
 * and `user` travel via {@link buildPushoverBody}, which the dispatch layer
 * calls directly with its resolved config. Deliberately NOT registered in
 * `ADAPTERS` (see `adapters/index.ts`) and has no `detect`: Pushover's
 * endpoint is fixed (`api.pushover.net`), so it is selected by env/route
 * config, not by detecting a webhook URL — same reasoning as `ntfyAdapter`.
 */
export const pushoverAdapter: NotificationAdapter = {
  id: 'pushover',
  buildBody: (payload: AlertPayload) => buildPushoverMessage(payload),
}
