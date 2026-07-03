/**
 * Tests for the OTel trace-export gating logic.
 *
 * Real test intent: fails-before/passes-after — with CHM_OTEL_EXPORTER_URL
 * unset (or invalid), tracing must be a true no-op (no tracer, no exporter
 * constructed). With a valid absolute http(s) URL, a real tracer backed by a
 * BatchSpanProcessor/OTLPTraceExporter must be constructed. Constructing
 * these objects never makes a network call by itself (only an actual flush
 * does), so this is safe to assert without mocking the network.
 */

import { __resetOtelForTests, forceFlushOtel, getOtelTracer } from './exporter'
import {
  buildOtelResourceAttributes,
  parseOtelExporterUrl,
} from './otel-options'
import { afterEach, describe, expect, test } from 'bun:test'

describe('parseOtelExporterUrl', () => {
  test('undefined -> disabled', () => {
    expect(parseOtelExporterUrl(undefined)).toBeUndefined()
  })

  test('empty string -> disabled', () => {
    expect(parseOtelExporterUrl('')).toBeUndefined()
  })

  test('whitespace-only -> disabled', () => {
    expect(parseOtelExporterUrl('   ')).toBeUndefined()
  })

  test('non-URL junk -> disabled', () => {
    expect(parseOtelExporterUrl('not a url')).toBeUndefined()
  })

  test('non-http(s) protocol -> disabled', () => {
    expect(
      parseOtelExporterUrl('ftp://collector.example.com/v1/traces')
    ).toBeUndefined()
  })

  test('relative path -> disabled (must be absolute)', () => {
    expect(parseOtelExporterUrl('/v1/traces')).toBeUndefined()
  })

  test('valid http URL -> passes through', () => {
    expect(
      parseOtelExporterUrl('http://collector.example.com:4318/v1/traces')
    ).toBe('http://collector.example.com:4318/v1/traces')
  })

  test('valid https URL -> passes through', () => {
    expect(
      parseOtelExporterUrl('https://collector.example.com/v1/traces')
    ).toBe('https://collector.example.com/v1/traces')
  })

  test('trims surrounding whitespace', () => {
    expect(
      parseOtelExporterUrl('  http://collector.example.com/v1/traces  ')
    ).toBe('http://collector.example.com/v1/traces')
  })
})

describe('buildOtelResourceAttributes', () => {
  test('includes service name + edition; omits version when absent (honest claims)', () => {
    const attrs = buildOtelResourceAttributes({
      version: undefined,
      edition: 'community',
    })
    expect(attrs['service.name']).toBe('chmonitor')
    expect(attrs['chmonitor.edition']).toBe('community')
    expect('service.version' in attrs).toBe(false)
  })

  test('includes version when present', () => {
    const attrs = buildOtelResourceAttributes({
      version: 'abc123',
      edition: 'enterprise',
    })
    expect(attrs['service.version']).toBe('abc123')
    expect(attrs['chmonitor.edition']).toBe('enterprise')
  })
})

describe('getOtelTracer', () => {
  afterEach(() => {
    __resetOtelForTests()
  })

  test('CHM_OTEL_EXPORTER_URL unset -> no-op (undefined tracer)', () => {
    const tracer = getOtelTracer({})
    expect(tracer).toBeUndefined()
  })

  test('CHM_OTEL_EXPORTER_URL invalid -> stays disabled (fail-open, no throw)', () => {
    const tracer = getOtelTracer({ CHM_OTEL_EXPORTER_URL: 'not-a-url' })
    expect(tracer).toBeUndefined()
  })

  test('CHM_OTEL_EXPORTER_URL valid -> a real tracer is built (BatchSpanProcessor/exporter configured)', () => {
    const tracer = getOtelTracer({
      CHM_OTEL_EXPORTER_URL: 'http://collector.invalid:4318/v1/traces',
    })
    expect(tracer).toBeDefined()
    expect(typeof tracer?.startActiveSpan).toBe('function')
  })

  test('memoized: first call wins for the lifetime of the singleton', () => {
    const first = getOtelTracer({}) // disabled
    const second = getOtelTracer({
      CHM_OTEL_EXPORTER_URL: 'http://collector.invalid:4318/v1/traces',
    })
    expect(first).toBeUndefined()
    expect(second).toBeUndefined() // still disabled — reused the memoized result
  })
})

describe('forceFlushOtel', () => {
  afterEach(() => {
    __resetOtelForTests()
  })

  test('no-op when tracing was never initialized', async () => {
    await expect(forceFlushOtel()).resolves.toBeUndefined()
  })

  test('no-op when tracing is disabled', async () => {
    getOtelTracer({})
    await expect(forceFlushOtel()).resolves.toBeUndefined()
  })
})
