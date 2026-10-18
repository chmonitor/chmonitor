// Typed, privacy-first telemetry entry point.
//
// `track()` is a HARD no-op unless telemetry is enabled (see config.ts): when
// disabled it returns immediately and makes zero network calls. When enabled it
// redacts props and fans the event out to any registered sinks.
//
// There is no default sink — transports (self-hosted ClickHouse, opt-in
// instance ping) are wired in later PRs. That keeps this module safe to import
// anywhere today without changing behaviour ("dark" by construction).

import type { TelemetryEvent, TelemetryPayload, TelemetryProps } from './events'

import { isTelemetryEnabled } from './config'
import { redactProps } from './redact'

export type TelemetrySink = (payload: TelemetryPayload) => void

const sinks = new Set<TelemetrySink>()

export function registerTelemetrySink(sink: TelemetrySink): () => void {
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
}

export function clearTelemetrySinks(): void {
  sinks.clear()
}

export function track(
  event: TelemetryEvent,
  props: TelemetryProps = {},
  runtimeEnv?: Record<string, string | undefined>
): void {
  // Hard gate: disabled telemetry does nothing and touches no network.
  if (!isTelemetryEnabled(runtimeEnv)) return

  const payload: TelemetryPayload = { event, props: redactProps(props) }
  for (const sink of sinks) {
    try {
      sink(payload)
    } catch {
      // Telemetry must never break the app — swallow sink errors.
    }
  }
}
