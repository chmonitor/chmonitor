/**
 * Generic JSON notification adapter (pure formatter).
 *
 * Produces a clean, normalized JSON body for arbitrary webhook receivers that
 * do not follow a vendor-specific schema. This is the fallback shape used when
 * no channel-specific adapter matches the webhook URL.
 */

import type { AlertPayload, NotificationAdapter } from './types'

import { summarizeDigest } from './digest'

/** Normalized JSON body for generic webhook receivers. */
export interface GenericJsonBody {
  severity: AlertPayload['severity']
  title: string
  metric: string
  value: number | null
  thresholds: { warning: number | null; critical: number | null }
  host: { id: number; label: string }
  label: string
  runbookUrls: string[]
  timestamp: string
  /** A ready-to-render one-line summary, mirroring the sweep/webhook text. */
  text: string
  snapshot?: unknown
}

/**
 * Build the normalized generic JSON body for a payload.
 */
export function buildGenericJsonBody(payload: AlertPayload): GenericJsonBody {
  const heading =
    payload.severity === 'recovery'
      ? 'RECOVERY'
      : payload.severity.toUpperCase()

  const body: GenericJsonBody = {
    severity: payload.severity,
    title: payload.title,
    metric: payload.metric,
    value: payload.value,
    thresholds: {
      warning: payload.warnThreshold ?? null,
      critical: payload.critThreshold ?? null,
    },
    host: { id: payload.hostId, label: payload.hostLabel },
    label: payload.label,
    runbookUrls: payload.runbookUrls ? [...payload.runbookUrls] : [],
    timestamp: payload.timestamp,
    text: `[${heading}] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`,
  }

  if (payload.snapshot !== undefined) {
    body.snapshot = payload.snapshot
  }

  return body
}

/**
 * Normalized JSON body for a GROUP of findings bound for the same generic
 * webhook (feat #2663). Carries the summary counts, a `text` one-liner block,
 * and the full per-finding array so a structured receiver can fan back out.
 */
export interface GenericJsonDigestBody {
  /** Discriminator so receivers can branch single vs digest on one field. */
  digest: true
  summary: string
  counts: { critical: number; warning: number; recovery: number }
  hostCount: number
  count: number
  /** Every finding, each as the same normalized single-alert body. */
  alerts: GenericJsonBody[]
  /** A ready-to-render multi-line summary (summary line + one line per finding). */
  text: string
}

/**
 * Build the normalized generic JSON digest body for a group of findings. Unlike
 * the channel-specific text bodies this carries the FULL finding array (no line
 * cap) since a JSON receiver is structured, not size-limited like chat.
 */
export function buildGenericJsonDigestBody(
  payloads: readonly AlertPayload[]
): GenericJsonDigestBody {
  const digest = summarizeDigest(payloads)
  const textLines = [
    `${digest.summaryLine} (${digest.total} alerts)`,
    ...payloads.map(
      (p) =>
        `[${p.severity === 'recovery' ? 'RECOVERY' : p.severity.toUpperCase()}] ${p.title} — ${p.label} (host ${p.hostLabel})`
    ),
  ]
  return {
    digest: true,
    summary: digest.summaryLine,
    counts: digest.counts,
    hostCount: digest.hostCount,
    count: digest.total,
    alerts: payloads.map(buildGenericJsonBody),
    text: textLines.join('\n'),
  }
}

/**
 * Generic JSON adapter. Has no `detect` — it is the catch-all fallback the
 * registry uses when no channel-specific adapter matches.
 */
export const genericJsonAdapter: NotificationAdapter = {
  id: 'generic-json',
  buildBody: (payload: AlertPayload) => buildGenericJsonBody(payload),
}
