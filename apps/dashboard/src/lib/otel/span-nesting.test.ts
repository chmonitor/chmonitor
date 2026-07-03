/**
 * Proves the composition withSpan() relies on actually nests spans: with a
 * real AsyncLocalStorageContextManager registered (as exporter.ts does on the
 * enabled path), a child withSpan() call started after an `await` inside the
 * parent's callback still comes out as a child of the parent — i.e. the
 * `dashboard-request` -> `clickhouse-query` tree from
 * plans/39-otel-trace-export.md actually forms across an async boundary, not
 * just when called synchronously.
 *
 * This does NOT prove start.ts's real request middleware -> TanStack `next()`
 * -> route handler -> query executor chain preserves the same ALS store
 * (that residual is only verified end-to-end against a real collector) — it
 * proves the withSpan/AsyncLocalStorageContextManager composition itself is
 * capable of nesting, which is the part under this module's control.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
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

import { withSpan } from './with-span'

describe('withSpan nesting (real AsyncLocalStorageContextManager)', () => {
  beforeAll(() => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable()
    )
  })

  afterAll(() => {
    context.disable()
  })

  test('a child span started after an await still parents under the root', async () => {
    memoryExporter.reset()

    await withSpan('dashboard-request', {}, async () => {
      // Simulate the async gap between the middleware's withSpan call and the
      // nested clickhouse-query call several awaits later (TanStack's next()
      // -> route handler -> query executor).
      await new Promise((resolve) => setTimeout(resolve, 0))
      await withSpan('clickhouse-query', { query_id: 'q-1' }, async () => 'ok')
    })

    const spans = memoryExporter.getFinishedSpans()
    const root = spans.find((s) => s.name === 'dashboard-request')
    const child = spans.find((s) => s.name === 'clickhouse-query')

    expect(root).toBeDefined()
    expect(child).toBeDefined()
    expect(child?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId)
    expect(child?.spanContext().traceId).toBe(root?.spanContext().traceId)
  })

  test('two concurrent root spans do not cross-contaminate their children', async () => {
    memoryExporter.reset()

    await Promise.all([
      withSpan('dashboard-request', {}, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        await withSpan('clickhouse-query', {}, async () => 'a')
      }),
      withSpan('dashboard-request', {}, async () => {
        await withSpan('clickhouse-query', {}, async () => 'b')
      }),
    ])

    const spans = memoryExporter.getFinishedSpans()
    const roots = spans.filter((s) => s.name === 'dashboard-request')
    const children = spans.filter((s) => s.name === 'clickhouse-query')
    expect(roots).toHaveLength(2)
    expect(children).toHaveLength(2)

    // Each child's traceId must match exactly one root's traceId (its own
    // request), never the other concurrent request's trace.
    for (const child of children) {
      const matchingRoots = roots.filter(
        (r) => r.spanContext().traceId === child.spanContext().traceId
      )
      expect(matchingRoots).toHaveLength(1)
      expect(child.parentSpanContext?.spanId).toBe(
        matchingRoots[0].spanContext().spanId
      )
    }
  })
})
