// Telemetry event transport. Installs a sink that POSTs typed, redacted events
// to the shared telemetry service (the same endpoint the instance ping uses).
//
// track() already gates on isTelemetryEnabled and redacts props before calling
// sinks, so this transport only has to deliver. It is a hard no-op when
// telemetry is disabled, when no endpoint resolves, or when fetch is
// unavailable (SSR / prerender / non-browser).

import type { TelemetryPayload } from './events'

import { isTelemetryEnabled } from './config'
import { getDeployTarget } from './environment'
import {
  getChmVersion,
  getPingEndpoint,
  STORAGE_KEY_INSTANCE_ID,
  sha256hex,
} from './instance-ping'
import { registerTelemetrySink } from './track'

let unregister: (() => void) | null = null

// The ping can regenerate the stored instance id (ClickHouse hostname change),
// so memoize per raw value rather than once.
let hashed: { raw: string; hash: string } | null = null

/**
 * The same instance hash the daily ping sends as `id`, derived from the stored
 * instance id at send time. Events must carry it: the service counts an
 * id-less event as a separate daily user, which would inflate DAU. Undefined
 * only before the first ping has stored an id (or when storage is unavailable).
 */
async function currentInstanceHash(): Promise<string | undefined> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INSTANCE_ID)
    if (!raw) return undefined
    if (hashed?.raw === raw) return hashed.hash
    const hash = await sha256hex(raw)
    hashed = { raw, hash }
    return hash
  } catch {
    return undefined
  }
}

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

  const endpoint = getPingEndpoint(runtimeEnv)
  if (!endpoint) return

  const deployTarget = getDeployTarget()
  const version = getChmVersion()
  unregister = registerTelemetrySink((payload: TelemetryPayload) => {
    void (async () => {
      const id = await currentInstanceHash()
      const body = JSON.stringify({
        event: payload.event,
        id,
        version,
        // deploy_target is a useful default dimension; explicit props win.
        props: { deploy_target: deployTarget, ...payload.props },
      })
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      })
    })().catch(() => {
      // A failed telemetry POST must never surface to the app.
    })
  })
}

/** Remove the event sink (teardown / tests). */
export function uninstallTelemetryEventSink(): void {
  if (unregister) {
    unregister()
    unregister = null
  }
}
