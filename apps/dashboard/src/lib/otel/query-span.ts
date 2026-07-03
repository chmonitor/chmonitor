// Wraps a single @chm/clickhouse-client execution call (fetchData /
// fetchJsonEachRowAsNormalizedJson) in a `clickhouse-query` span — the child
// of the `dashboard-request` root span started in start.ts.
//
// Attributes (query_id, read_bytes, host) are populated from the actual
// FetchDataResult metadata AFTER the call resolves — never claimed up front,
// per the "only attach attributes you actually populate" invariant.
//
// There is no distinguishable "system-table-read" seam below this: fetchData
// makes exactly one HTTP call per invocation (ClickHouse does its own
// system-table reads server-side, invisible to this client), so the span tree
// collapses to two levels here (dashboard-request -> clickhouse-query)
// instead of three, per plans/39-otel-trace-export.md's own fallback.

import type { Attributes } from '@opentelemetry/api'

import { withSpan } from './with-span'
import { SpanStatusCode } from '@opentelemetry/api'

interface ClickHouseFetchLike {
  metadata: Record<string, string | number>
  error?: { message: string }
}

export async function withClickHouseQuerySpan<T extends ClickHouseFetchLike>(
  fn: () => Promise<T>
): Promise<T> {
  return withSpan('clickhouse-query', {}, async (span) => {
    const result = await fn()

    if (span) {
      const attributes: Attributes = {}
      if (result.metadata.queryId) {
        attributes.query_id = String(result.metadata.queryId)
      }
      if (typeof result.metadata.readBytes === 'number') {
        attributes.read_bytes = result.metadata.readBytes
      }
      if (result.metadata.host) {
        attributes.host = String(result.metadata.host)
      }
      span.setAttributes(attributes)

      // fetchData/fetchJsonEachRowAsNormalizedJson report failures as a value
      // (result.error), not a thrown exception, so withSpan's own try/catch
      // never sees them — record the status here instead.
      if (result.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: result.error.message,
        })
      }
    }

    return result
  })
}
