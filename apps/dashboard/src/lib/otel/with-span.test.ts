/**
 * Tests for withSpan's span-shape behavior (name, attributes, status,
 * exception recording) and its true-no-op-when-disabled path.
 *
 * getOtelTracer is stubbed via mock.module (same pattern as
 * clickhouse-helpers.test.ts) so the "enabled" case captures real spans
 * in-memory instead of constructing a real OTLPTraceExporter/network call.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

// ── Stub the tracer resolution before any import of the module under test. ──

const memoryExporter = new InMemorySpanExporter()
const testProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
})
const testTracer = testProvider.getTracer('test')

let tracerEnabled = true

mock.module('./exporter', () => ({
  getOtelTracer: () => (tracerEnabled ? testTracer : undefined),
}))

// ── Import AFTER the mock is registered ──────────────────────────────────

import { withSpan } from './with-span'

beforeEach(() => {
  tracerEnabled = true
  memoryExporter.reset()
})

describe('withSpan — disabled (no-op)', () => {
  test('runs fn directly without creating a span', async () => {
    tracerEnabled = false
    let sawSpan: unknown = 'unset'

    const result = await withSpan(
      'clickhouse-query',
      { foo: 'bar' },
      async (span) => {
        sawSpan = span
        return 42
      }
    )

    expect(result).toBe(42)
    expect(sawSpan).toBeUndefined()
    expect(memoryExporter.getFinishedSpans()).toHaveLength(0)
  })
})

describe('withSpan — enabled', () => {
  test('produces a span with the expected name + attributes', async () => {
    await withSpan(
      'clickhouse-query',
      { query_id: 'abc-123', host: 'localhost' },
      async () => 'ok'
    )

    const spans = memoryExporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('clickhouse-query')
    expect(spans[0].attributes.query_id).toBe('abc-123')
    expect(spans[0].attributes.host).toBe('localhost')
    // UNSET (not explicitly OK) is the OTel convention for "no error" — see
    // with-span.ts's comment on why the success path never sets OK.
    expect(spans[0].status.code).toBe(SpanStatusCode.UNSET)
  })

  test('returns the callback result', async () => {
    const result = await withSpan('clickhouse-query', {}, async () => ({
      data: [1, 2, 3],
    }))
    expect(result).toEqual({ data: [1, 2, 3] })
  })

  test('ends the span and records the exception when fn throws, then rethrows', async () => {
    await expect(
      withSpan('clickhouse-query', {}, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    const spans = memoryExporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0].status.message).toBe('boom')
    expect(spans[0].events.some((e) => e.name === 'exception')).toBe(true)
    // ended (has a non-zero end time), even though fn threw
    expect(spans[0].endTime).not.toEqual([0, 0])
  })
})
