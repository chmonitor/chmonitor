/**
 * Opsgenie notification adapter (pure formatter).
 *
 * Builds an Opsgenie Alert API v2 "Create Alert" body
 * (`https://api.opsgenie.com/v2/alerts`, EU: `https://api.eu.opsgenie.com/v2/alerts`).
 * Severity maps onto Opsgenie priorities (P1-P5), and a stable `alias` is
 * derived from the payload so repeat firings collapse onto one alert — a
 * `recovery` payload closes that alias instead of creating a new one.
 *
 * Auth (`Authorization: GenieKey <API_KEY>`) and the create-vs-close request
 * routing are applied by the dispatch layer (`../opsgenie-dispatch.ts`), not
 * this pure builder — mirrors `pagerduty.ts`.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Opsgenie Alert API v2 priorities. */
export type OpsgeniePriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

/** Map our severity onto Opsgenie's priority vocabulary. */
const SEVERITY_MAP: Record<AlertSeverity, OpsgeniePriority> = {
  critical: 'P1',
  warning: 'P2',
  // Not sent as a create priority — recovery closes the alias instead of
  // creating an alert. Kept so the label always resolves to something sane.
  recovery: 'P3',
}

/** Caller-supplied Opsgenie transport config (resolved by the dispatch layer). */
export interface OpsgenieConfig {
  apiKey: string
}

/** Opsgenie Alert API v2 "Create Alert" request body. */
export interface OpsgenieCreateBody {
  message: string
  alias: string
  priority: OpsgeniePriority
  source: string
  tags: string[]
  /** Opsgenie requires detail values to be strings. */
  details: Record<string, string>
  description?: string
}

/** Stable alias so repeat firings collapse to one Opsgenie alert. */
export function opsgenieAlias(payload: AlertPayload): string {
  return `chmonitor:${payload.hostId}:${payload.metric}`
}

/**
 * Build the Opsgenie Alert API v2 create-alert body for a payload.
 *
 * Used as-is for `warning`/`critical` (trigger) severities. For `recovery`,
 * the dispatch layer reads `payload.severity` to route to the close-alias
 * endpoint (`POST /v2/alerts/{alias}/close?identifierType=alias`) instead of
 * creating a new alert; only this body's `.message` is reused there.
 */
export function buildOpsgenieBody(payload: AlertPayload): OpsgenieCreateBody {
  const body: OpsgenieCreateBody = {
    message: `${payload.title} — ${payload.label} (host ${payload.hostLabel})`,
    alias: opsgenieAlias(payload),
    priority: SEVERITY_MAP[payload.severity],
    source: 'chmonitor',
    tags: [
      `host:${payload.hostLabel}`,
      `metric:${payload.metric}`,
      'chmonitor',
    ],
    details: {
      hostId: String(payload.hostId),
      metric: payload.metric,
      value: payload.value === null ? 'n/a' : String(payload.value),
      warnThreshold:
        payload.warnThreshold == null ? 'n/a' : String(payload.warnThreshold),
      critThreshold:
        payload.critThreshold == null ? 'n/a' : String(payload.critThreshold),
      timestamp: payload.timestamp,
    },
  }

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    body.description = `Runbooks:\n${payload.runbookUrls.join('\n')}`
  }

  return body
}

/**
 * Opsgenie adapter. `buildBody` needs no config — Opsgenie auth is a header
 * (`GenieKey <API_KEY>`) applied by the dispatch layer, never part of the
 * body.
 */
export const opsgenieAdapter: NotificationAdapter = {
  id: 'opsgenie',
  detect: (url: string) => /(?:^|\/\/)api(?:\.eu)?\.opsgenie\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildOpsgenieBody(payload),
}
