// Telemetry event transport. Installs a sink that POSTs typed, redacted events
// to the collector's /v1/event endpoint.
//
// track() already gates on isTelemetryEnabled and redacts props before calling
// sinks, so this transport only has to deliver. It is a hard no-op when
// telemetry is disabled, when no endpoint resolves, or when fetch is
// unavailable (SSR / prerender / non-browser).

import type { TelemetryPayload } from './events'

import { isTelemetryEnabled } from './config'
import { getDeployTarget } from './environment'
import { getPingEndpoint } from './instance-ping'
import { registerTelemetrySink } from './track'

const PING_PATH = '/v1/ping'
const EVENT_PATH = '/v1/event'

/**
 * Derives the event endpoint from the configured ping endpoint: the collector
 * exposes /v1/ping and /v1/event under the same origin. A custom endpoint that
 * does not use the /v1/ping suffix is returned unchanged (single-URL ingest).
 */
export function getEventEndpoint(
  runtimeEnv?: Record<string, string | undefined>
): string {
  const ping = getPingEndpoint(runtimeEnv)
  if (!ping) return ''
  return ping.endsWith(PING_PATH)
    ? `${ping.slice(0, -PING_PATH.length)}${EVENT_PATH}`
    : ping
}

let unregister: (() => void) | null = null

/**
 * Install the telemetry event sink (idempotent). Fire-and-forget POST per event,
 * with all errors swallowed — telemetry must never affect the app. No-op when
 * telemetry is disabled, no endpoint resolves, or fetch is unavailable.
 */
export function installTelemetryEventSink(
  runtimeEnv?: Record<string, string | undefined>
): void {
  if (unregister) return
  if (typeof fetch !== 'function') return
  if (!isTelemetryEnabled(runtimeEnv)) return

  const endpoint = getEventEndpoint(runtimeEnv)
  if (!endpoint) return

  const deployTarget = getDeployTarget()
  unregister = registerTelemetrySink((payload: TelemetryPayload) => {
    const body = JSON.stringify({
      event: payload.event,
      // deploy_target is a useful default dimension; explicit props win.
      props: { deploy_target: deployTarget, ...payload.props },
    })
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // A failed telemetry POST must never surface to the app.
    })
  })
}

export function uninstallTelemetryEventSink(): void {
  if (unregister) {
    unregister()
    unregister = null
  }
}
