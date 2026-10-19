import {
  DEFAULT_TELEMETRY_ENDPOINT,
  resolveClientTelemetryEndpoint,
} from './endpoint'
import { describe, expect, test } from 'bun:test'

describe('resolveClientTelemetryEndpoint', () => {
  test('falls back to the shared service when neither var is set', () => {
    expect(resolveClientTelemetryEndpoint({})).toBe(DEFAULT_TELEMETRY_ENDPOINT)
  })

  test('CHM_TELEMETRY_ENDPOINT self-hosts the browser build', () => {
    expect(
      resolveClientTelemetryEndpoint({
        CHM_TELEMETRY_ENDPOINT: 'https://telemetry.internal.example/chmonitor',
      })
    ).toBe('https://telemetry.internal.example/chmonitor')
  })

  test('an empty CHM_TELEMETRY_ENDPOINT stays the no-network kill-switch', () => {
    // '' must survive, not collapse to the default: getPingEndpoint treats an
    // empty endpoint as "make no network call at all".
    expect(resolveClientTelemetryEndpoint({ CHM_TELEMETRY_ENDPOINT: '' })).toBe(
      ''
    )
  })

  test('VITE_TELEMETRY_ENDPOINT wins over the canonical CHM_ name', () => {
    expect(
      resolveClientTelemetryEndpoint({
        VITE_TELEMETRY_ENDPOINT: 'https://explicit.example/chmonitor',
        CHM_TELEMETRY_ENDPOINT: 'https://canonical.example/chmonitor',
      })
    ).toBe('https://explicit.example/chmonitor')
  })

  test('an empty VITE_TELEMETRY_ENDPOINT is not overridden by CHM_*', () => {
    expect(
      resolveClientTelemetryEndpoint({
        VITE_TELEMETRY_ENDPOINT: '',
        CHM_TELEMETRY_ENDPOINT: 'https://canonical.example/chmonitor',
      })
    ).toBe('')
  })
})
