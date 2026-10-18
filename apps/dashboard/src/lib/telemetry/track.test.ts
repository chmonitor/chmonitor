import type { TelemetryPayload } from './events'

import { clearTelemetrySinks, registerTelemetrySink, track } from './track'
import { afterEach, describe, expect, test } from 'bun:test'

afterEach(() => {
  clearTelemetrySinks()
})

describe('track', () => {
  test('is a no-op when telemetry is disabled', () => {
    const seen: TelemetryPayload[] = []
    registerTelemetrySink((payload) => seen.push(payload))

    track('app_loaded', { num_hosts: 1 }, { DO_NOT_TRACK: '1' })
    track('health_viewed', {}, { CHM_TELEMETRY: 'off' })

    expect(seen).toHaveLength(0)
  })

  test('emits to sinks when enabled, with redaction applied', () => {
    const seen: TelemetryPayload[] = []
    registerTelemetrySink((payload) => seen.push(payload))

    track(
      'cluster_connected',
      { ch_flavor: 'oss', host: 'secret.internal', num_hosts: 2 },
      { CHM_TELEMETRY: 'on' }
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      event: 'cluster_connected',
      props: { ch_flavor: 'oss', num_hosts: 2 }, // `host` dropped by redaction
    })
  })

  test('sink errors never propagate to the caller', () => {
    registerTelemetrySink(() => {
      throw new Error('boom')
    })
    const ok: TelemetryPayload[] = []
    registerTelemetrySink((payload) => ok.push(payload))

    expect(() =>
      track('ai_query_sent', { model_count: 1 }, { CHM_TELEMETRY: 'on' })
    ).not.toThrow()
    expect(ok).toHaveLength(1)
  })

  test('unsubscribe stops delivery', () => {
    const seen: TelemetryPayload[] = []
    const off = registerTelemetrySink((payload) => seen.push(payload))
    off()

    track('queries_viewed', {}, { CHM_TELEMETRY: 'on' })

    expect(seen).toHaveLength(0)
  })
})
