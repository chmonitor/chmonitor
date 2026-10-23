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

import { firedForLine, incidentLine } from './digest'
import { valueText } from './facts'
import { instancePrefix } from './identity'

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

/** Opsgenie rejects a create-alert `message` longer than this (Alert API docs: "130 characters maximum"). */
export const OPSGENIE_MESSAGE_MAX = 130

function truncateMessage(message: string): string {
  const chars = Array.from(message)
  return chars.length <= OPSGENIE_MESSAGE_MAX
    ? message
    : `${chars.slice(0, OPSGENIE_MESSAGE_MAX - 1).join('')}…`
}

/** Close-alert note: the resolved message plus how long the incident fired. */
export function opsgenieCloseNote(payload: AlertPayload): string {
  const firedFor = firedForLine(payload)
  const note = `${instancePrefix(payload)}[RESOLVED] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`
  return firedFor ? `${note}, ${firedFor}` : note
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
 * creating a new alert, with {@link opsgenieCloseNote} as the note.
 */
export function buildOpsgenieBody(payload: AlertPayload): OpsgenieCreateBody {
  const incident = incidentLine(payload)
  const body: OpsgenieCreateBody = {
    message: truncateMessage(
      `${instancePrefix(payload)}${payload.severity === 'recovery' ? '[RESOLVED] ' : ''}${payload.title} — ${payload.label} (host ${payload.hostLabel})`
    ),
    alias: opsgenieAlias(payload),
    priority: SEVERITY_MAP[payload.severity],
    source: 'chmonitor',
    tags: [
      `host:${payload.hostLabel}`,
      `metric:${payload.metric}`,
      'chmonitor',
    ],
    details: {
      // First so operator metadata can never overwrite the fixed keys.
      ...payload.metadata,
      hostId: String(payload.hostId),
      metric: payload.metric,
      severity: payload.severity === 'recovery' ? 'resolved' : payload.severity,
      value: valueText(payload),
      warnThreshold:
        payload.warnThreshold == null ? 'n/a' : String(payload.warnThreshold),
      critThreshold:
        payload.critThreshold == null ? 'n/a' : String(payload.critThreshold),
      timestamp: payload.timestamp,
      ...(incident ? { status: incident } : {}),
      ...(payload.instanceName ? { instanceName: payload.instanceName } : {}),
      ...(payload.dashboardUrl ? { dashboardUrl: payload.dashboardUrl } : {}),
    },
  }

  const description = [
    ...(incident ? [`Status: ${incident}`] : []),
    ...(payload.dashboardUrl ? [`Dashboard: ${payload.dashboardUrl}`] : []),
    ...(payload.runbookUrls && payload.runbookUrls.length > 0
      ? [`Runbooks:\n${payload.runbookUrls.join('\n')}`]
      : []),
  ].join('\n\n')
  if (description) body.description = description

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
