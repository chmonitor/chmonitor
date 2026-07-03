/**
 * Tests for withClickHouseQuerySpan's metadata -> attribute mapping: only
 * attach query_id/read_bytes/host when the underlying FetchDataResult
 * actually populates them (honest-claims invariant), and mark the span ERROR
 * when the result carries a "soft" error value (fetchData never throws for
 * query errors — it returns `{ error }`).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

const memoryExporter = new InMemorySpanExporter()
const testProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
})
const testTracer = testProvider.getTracer('test')

mock.module('./exporter', () => ({
  getOtelTracer: () => testTracer,
}))

import { withClickHouseQuerySpan } from './query-span'

beforeEach(() => {
  memoryExporter.reset()
})

describe('withClickHouseQuerySpan', () => {
  test('attaches query_id, read_bytes, host when present', async () => {
    await withClickHouseQuerySpan(async () => ({
      metadata: { queryId: 'q-1', readBytes: 2048, host: 'ch-01' },
    }))

    const [span] = memoryExporter.getFinishedSpans()
    expect(span.name).toBe('clickhouse-query')
    expect(span.attributes.query_id).toBe('q-1')
    expect(span.attributes.read_bytes).toBe(2048)
    expect(span.attributes.host).toBe('ch-01')
    // UNSET (not explicitly OK) is the OTel convention for "no error".
    expect(span.status.code).toBe(SpanStatusCode.UNSET)
  })

  test('omits read_bytes when not populated (honest claims)', async () => {
    await withClickHouseQuerySpan(async () => ({
      metadata: { queryId: 'q-2', host: 'ch-01' },
    }))

    const [span] = memoryExporter.getFinishedSpans()
    expect('read_bytes' in span.attributes).toBe(false)
  })

  test('marks the span ERROR for a "soft" result.error (no throw)', async () => {
    const result = await withClickHouseQuerySpan(async () => ({
      metadata: { queryId: '', host: 'ch-01' },
      error: { message: 'table not found' },
    }))

    expect(result.error?.message).toBe('table not found')
    const [span] = memoryExporter.getFinishedSpans()
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
    expect(span.status.message).toBe('table not found')
  })

  test('returns the callback result unchanged', async () => {
    const result = await withClickHouseQuerySpan(async () => ({
      metadata: { queryId: 'q-3' },
      dataJson: '[1,2,3]',
    }))
    expect(result.dataJson).toBe('[1,2,3]')
  })
})
