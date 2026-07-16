import {
  buildPagerDutyBody,
  buildTelegramBody,
  buildWebhookDispatchBody,
} from './adapters'
import { loadAlertSettings } from './alert-settings-storage'

// Duplicated (not imported) from `pagerduty-config.ts` on purpose: that
// module reads server-only env vars (`process.env`), and this file is
// client-side (browser `window`/`localStorage` checks below) — importing it
// would pull a server-only module into the client bundle. The endpoint
// itself is fixed and public (same for every PagerDuty service), so a
// literal here carries no secret.
const PAGERDUTY_EVENTS_API_URL = 'https://events.pagerduty.com/v2/enqueue'

/** Actionable health severities used for escalation/recovery bookkeeping. */
export type HealthAlertStatus = 'ok' | 'warning' | 'critical'

export interface HealthAlertEvent {
  checkId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
  hostId: number
  /**
   * Monotonic id used to keep dismissed notifications from suppressing later
   * incidents. Prefer a stable, windowed id (see {@link healthIncidentId}) so
   * repeated dispatches within the same window dedup downstream.
   */
  incidentId?: string
  /**
   * Whether this event raises an alert or clears one. Optional and defaults to
   * `'alert'` so existing consumers that ignore it keep working unchanged.
   */
  kind?: 'alert' | 'recovery'
}

const HEALTH_ALERT_EVENT = 'health-alert'

/**
 * Persisted last-seen status per `host::checkId`, so escalation state survives
 * component remount / navigation and {@link dispatchAlert} does not re-fire when
 * the user returns to /health. Mirrors the storage shape of
 * {@link file://./thresholds-storage.ts} / {@link file://./history-storage.ts}.
 */
const ALERT_STATUS_STORAGE_KEY = 'health-alert-status'

/** Dedup window for stable health incident ids (1 minute). */
const INCIDENT_WINDOW_MS = 60_000

export type AlertStatusMap = Record<string, HealthAlertStatus>

/** Storage key for a single check's last-seen status. */
export function alertStatusKey(hostId: number, checkId: string): string {
  return `${hostId}::${checkId}`
}

/**
 * Stable, windowed incident id (same approach as regression-panel /
 * mv-staleness-badge) so repeated escalations within a window dedup downstream.
 */
export function healthIncidentId(
  hostId: number,
  checkId: string,
  severity: HealthAlertStatus
): string {
  return `hc-${hostId}-${checkId}-${severity}-${Math.floor(Date.now() / INCIDENT_WINDOW_MS)}`
}

export function loadAlertStatuses(): AlertStatusMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(ALERT_STATUS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const sanitized: AlertStatusMap = {}
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (value === 'ok' || value === 'warning' || value === 'critical') {
        sanitized[key] = value
      }
    }
    return sanitized
  } catch {
    return {}
  }
}

export function saveAlertStatuses(map: AlertStatusMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ALERT_STATUS_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Quota or serialization failure — escalation dedup is best-effort, ignore.
  }
}

export function emitInAppAlert(alert: HealthAlertEvent): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<HealthAlertEvent>(HEALTH_ALERT_EVENT, { detail: alert })
  )
}

export function subscribeInAppAlerts(
  handler: (alert: HealthAlertEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const e = event as CustomEvent<HealthAlertEvent>
    handler(e.detail)
  }
  window.addEventListener(HEALTH_ALERT_EVENT, listener)
  return () => window.removeEventListener(HEALTH_ALERT_EVENT, listener)
}

/** Notification/webhook label: severity for alerts, "RESOLVED" for recoveries. */
function alertPrefix(alert: HealthAlertEvent): string {
  return alert.kind === 'recovery' ? 'RESOLVED' : alert.severity.toUpperCase()
}

export function fireBrowserNotification(alert: HealthAlertEvent): void {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(`[${alertPrefix(alert)}] ${alert.title}`, {
      body: alert.label,
      tag: `health:${alert.checkId}:${alert.severity}`,
    })
  } catch {
    // Some browsers throw when constructed outside a service worker
  }
}

export async function fireWebhook(
  alert: HealthAlertEvent,
  webhookUrl?: string
): Promise<boolean> {
  let url = webhookUrl
  if (!url) {
    const settings = loadAlertSettings()
    if (!settings.webhookEnabled || !settings.webhookUrl) return false
    url = settings.webhookUrl
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const text = `[${alertPrefix(alert)}] ${alert.title} — ${alert.label} (host ${alert.hostId})`
    // Per-URL body selection (#2656): a Discord target previews the real rich
    // embed via the proxy's verbatim `provider` path; every other URL keeps the
    // backward-compatible `{ url, text }` (the proxy wraps it as
    // `{ text, content }`). The client can't know if the server-side Slack app
    // is configured, so Slack stays plain text here — matching the pre-#2656
    // behavior.
    const dispatch = buildWebhookDispatchBody({
      url,
      text,
      payload: {
        severity: alert.kind === 'recovery' ? 'recovery' : alert.severity,
        hostLabel: `host ${alert.hostId}`,
        hostId: alert.hostId,
        metric: alert.checkId,
        value: alert.value,
        title: alert.title,
        label: alert.label,
        timestamp: new Date().toISOString(),
      },
    })
    const requestBody = dispatch.provider
      ? { url, provider: dispatch.provider, payload: dispatch.body }
      : { url, text }
    const res = await fetch('/api/v1/health/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fire a healthchecks.io ping. healthchecks.io accepts a GET to the check's
 * unique ping URL for success, or `<url>/fail` for failure. We route the GET
 * through the existing `/api/v1/health/webhook` proxy (which already permits
 * public HTTPS URLs and enforces SSRF guards) via its `provider: 'raw-get'`
 * verbatim-forward path — so no direct browser→healthchecks.io egress and no
 * new server endpoint is needed.
 */
export async function fireHealthchecks(
  url: string,
  kind: 'alert' | 'recovery'
): Promise<boolean> {
  const base = url.replace(/\/+$/, '')
  const target = kind === 'recovery' ? `${base}/fail` : base
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('/api/v1/health/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: target,
        provider: 'raw-get',
      }),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Send a test PagerDuty event (trigger, immediately followed by resolve) to a
 * specific service's routing key, via the `/api/v1/health/webhook` proxy's
 * `provider`-hint path (verbatim body forward — see `webhook.ts`) so the
 * setup dialog (plan 34) never needs a direct browser→PagerDuty fetch.
 */
export async function firePagerDutyTest(
  alert: HealthAlertEvent,
  routingKey: string
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const body = buildPagerDutyBody(
      {
        severity: alert.severity,
        hostLabel: `host ${alert.hostId}`,
        hostId: alert.hostId,
        metric: alert.checkId,
        value: alert.value,
        title: alert.title,
        label: alert.label,
        timestamp: new Date().toISOString(),
      },
      { routingKey }
    )
    const res = await fetch('/api/v1/health/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: PAGERDUTY_EVENTS_API_URL,
        provider: 'pagerduty',
        payload: body,
      }),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Send a test Telegram message to a specific bot token + chat id, via the
 * `/api/v1/health/webhook` proxy's `provider`-hint path (verbatim body
 * forward — see `webhook.ts`) so the routing dialog (#2655) never needs a
 * direct browser→Telegram fetch. The token is only ever sent to our own proxy
 * at creation time (the user just typed it), same posture as the PagerDuty
 * routing-key test above; it is never echoed back to the client after storage.
 */
export async function fireTelegramTest(
  alert: HealthAlertEvent,
  botToken: string,
  chatId: string
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const body = buildTelegramBody(
      {
        severity: alert.severity,
        hostLabel: `host ${alert.hostId}`,
        hostId: alert.hostId,
        metric: alert.checkId,
        value: alert.value,
        title: alert.title,
        label: alert.label,
        timestamp: new Date().toISOString(),
      },
      { token: botToken, chatId }
    )
    const res = await fetch('/api/v1/health/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `https://api.telegram.org/bot${botToken}/sendMessage`,
        provider: 'telegram',
        payload: body,
      }),
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export async function dispatchAlert(alert: HealthAlertEvent): Promise<void> {
  try {
    const settings = loadAlertSettings()
    if (settings.minSeverity === 'critical' && alert.severity !== 'critical') {
      return
    }
    const event: HealthAlertEvent = {
      ...alert,
      kind: alert.kind ?? 'alert',
      incidentId: alert.incidentId ?? String(Date.now()),
    }
    emitInAppAlert(event)
    if (settings.browserNotificationsEnabled) {
      fireBrowserNotification(event)
    }
    if (settings.webhookEnabled && settings.webhookUrl) {
      await fireWebhook(event)
    }
    if (settings.healthchecksUrl) {
      await fireHealthchecks(settings.healthchecksUrl, event.kind ?? 'alert')
    }
  } catch (err) {
    console.error('[health] dispatchAlert failed', err)
  }
}

/**
 * De-escalation: emit a recovery event when a check transitions back to `ok`.
 * `severity` carries the severity that just cleared, so downstream consumers can
 * match and clear the corresponding active alert. Honours the same `minSeverity`
 * gate as {@link dispatchAlert} so a warning recovery stays silent when only
 * critical alerts are enabled.
 */
export async function dispatchRecovery(alert: HealthAlertEvent): Promise<void> {
  try {
    const settings = loadAlertSettings()
    if (settings.minSeverity === 'critical' && alert.severity !== 'critical') {
      return
    }
    const event: HealthAlertEvent = {
      ...alert,
      kind: 'recovery',
      incidentId: alert.incidentId ?? String(Date.now()),
    }
    emitInAppAlert(event)
    if (settings.browserNotificationsEnabled) {
      fireBrowserNotification(event)
    }
    if (settings.webhookEnabled && settings.webhookUrl) {
      await fireWebhook(event)
    }
    if (settings.healthchecksUrl) {
      await fireHealthchecks(settings.healthchecksUrl, 'recovery')
    }
  } catch (err) {
    console.error('[health] dispatchRecovery failed', err)
  }
}

/** Severity ordering: ok < warning < critical. Returns true if `next` is more severe than `prev`. */
export function isEscalation(
  prev: HealthAlertStatus | null,
  next: HealthAlertStatus
): boolean {
  const order = { ok: 0, warning: 1, critical: 2 } as const
  if (prev === null) {
    // Alert on initial poll if the status is already unhealthy
    return next !== 'ok'
  }
  return order[next] > order[prev]
}
