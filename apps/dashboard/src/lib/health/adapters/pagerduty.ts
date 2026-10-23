/**
 * PagerDuty notification adapter (pure formatter).
 *
 * Builds a PagerDuty Events API v2 "Enqueue an Event" body
 * (`https://events.pagerduty.com/v2/enqueue`). Severity maps onto PagerDuty's
 * severity vocabulary, a `recovery` payload becomes a `resolve` event, and the
 * `dedup_key` is derived from the payload so repeat firings collapse onto one
 * incident. The `routing_key` comes from caller configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import { incidentLine } from './digest'
import { instancePrefix } from './identity'

/** PagerDuty Events API v2 severities. */
export type PagerDutySeverity = 'critical' | 'warning' | 'error' | 'info'

/** Map our severity onto PagerDuty's severity vocabulary. */
const SEVERITY_MAP: Record<AlertSeverity, PagerDutySeverity> = {
  critical: 'critical',
  warning: 'warning',
  recovery: 'info',
}

interface PagerDutyPayloadBody {
  summary: string
  source: string
  severity: PagerDutySeverity
  timestamp: string
  component: string
  custom_details: Record<string, unknown>
}

/** PagerDuty Events API v2 enqueue body. */
export interface PagerDutyEventBody {
  routing_key: string
  event_action: 'trigger' | 'resolve'
  dedup_key: string
  payload: PagerDutyPayloadBody
  links?: Array<{ href: string; text: string }>
}

/** Caller-supplied PagerDuty transport config. */
export interface PagerDutyConfig {
  /** Integration routing key (a.k.a. integration key). */
  routingKey: string
}

/** Stable dedup key so repeated firings of the same check collapse to one incident. */
export function pagerDutyDedupKey(payload: AlertPayload): string {
  return `chmonitor:${payload.hostId}:${payload.metric}`
}

/**
 * Build the PagerDuty Events API v2 body for a payload and routing key.
 */
export function buildPagerDutyBody(
  payload: AlertPayload,
  config: PagerDutyConfig
): PagerDutyEventBody {
  const eventAction = payload.severity === 'recovery' ? 'resolve' : 'trigger'

  const body: PagerDutyEventBody = {
    routing_key: config.routingKey,
    event_action: eventAction,
    dedup_key: pagerDutyDedupKey(payload),
    payload: {
      summary: `${instancePrefix(payload)}${payload.severity === 'recovery' ? '[RESOLVED] ' : ''}${payload.title} — ${payload.label} (host ${payload.hostLabel})`,
      // Readable origin for multi-deployment accounts; dedup_key stays
      // instance-independent so existing incidents keep collapsing.
      source: payload.instanceName
        ? `${payload.instanceName}/${payload.hostLabel}`
        : payload.hostLabel,
      severity: SEVERITY_MAP[payload.severity],
      timestamp: payload.timestamp,
      component: payload.metric,
      custom_details: {
        hostId: payload.hostId,
        hostLabel: payload.hostLabel,
        metric: payload.metric,
        value: payload.value,
        warnThreshold: payload.warnThreshold ?? null,
        critThreshold: payload.critThreshold ?? null,
        label: payload.label,
        ...(incidentLine(payload) ? { status: incidentLine(payload) } : {}),
        snapshot: payload.snapshot ?? null,
        ...(payload.instanceName ? { instanceName: payload.instanceName } : {}),
        ...(payload.dashboardUrl ? { dashboardUrl: payload.dashboardUrl } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {}),
      },
    },
  }

  const links = [
    ...(payload.dashboardUrl
      ? [{ href: payload.dashboardUrl, text: 'Open dashboard' }]
      : []),
    ...(payload.runbookUrls ?? []).map((href) => ({ href, text: 'Runbook' })),
  ]
  if (links.length > 0) body.links = links

  return body
}

/**
 * PagerDuty adapter. `buildBody` uses a placeholder routing key — the dispatch
 * layer substitutes the real key from config; use {@link buildPagerDutyBody}
 * directly when the config is available.
 */
export const pagerDutyAdapter: NotificationAdapter = {
  id: 'pagerduty',
  detect: (url: string) => /(?:^|\/\/)events\.pagerduty\.com\//i.test(url),
  buildBody: (payload: AlertPayload) =>
    buildPagerDutyBody(payload, { routingKey: '<routing_key>' }),
}
