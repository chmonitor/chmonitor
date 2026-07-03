// Small helper: runs `fn` inside an OTel span named `name`.
//
// True no-op when trace export is disabled (getOtelTracer() returns
// `undefined`): `fn()` runs directly, without creating a span or touching any
// other OTel API. That guard-before-span-creation is what keeps the OFF path
// free of added latency — see exporter.ts.
//
// The span always ends in a `finally` (so a thrown error still closes it) and
// records the exception before re-throwing, so existing error handling at the
// call site is unchanged.

import type { Attributes, Span } from '@opentelemetry/api'

import { getOtelTracer } from './exporter'
import { SpanStatusCode } from '@opentelemetry/api'

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span | undefined) => Promise<T>
): Promise<T> {
  const tracer = getOtelTracer()
  if (!tracer) return fn(undefined)

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      // Per OTel convention, a span left UNSET (not explicitly OK) is treated
      // as success by every viewer — only set ERROR, and only for a genuine
      // exception. This also means a caller's own status.setStatus(ERROR) for
      // a "soft" error value (e.g. fetchData's `{ error }` return, which
      // never throws) is not clobbered by this success path.
      return await fn(span)
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err))
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      span.end()
    }
  })
}
