// OTel trace export — opt-in, OFF by default.
//
// Self-hosted/OSS default: no CHM_OTEL_EXPORTER_URL configured -> getOtelTracer()
// returns `undefined` and every caller (see with-span.ts) skips straight to
// running its own work, without touching any other OTel API. That guard-first
// design is what keeps the disabled path a true no-op: zero network calls,
// zero spans, zero added latency.
//
// Set CHM_OTEL_EXPORTER_URL to an OTLP/HTTP collector endpoint (e.g. a Jaeger
// or Tempo instance) to export chmonitor's OWN query traces for correlation
// with the rest of your tracing stack. This is DISTINCT from the existing OTel
// span *viewer* (system.opentelemetry_span_log, see
// lib/query-config/system/opentelemetry-spans.ts) which only READS spans
// already stored in ClickHouse — this module EXPORTS chmonitor's own spans TO
// an external collector.
//
// Runs on Cloudflare Workers (workerd): uses BasicTracerProvider (platform
// agnostic — no Node-only APIs) and the OTLP/HTTP exporter (fetch-based, not
// gRPC). TanStack Start's request middleware does not expose the Worker
// ExecutionContext (see start.ts's sentryMiddleware comment for the same
// constraint), so there is no `waitUntil` to defer the batch flush past the
// response — forceFlushOtel() must be awaited inline before the response
// returns. That is only reachable when export is enabled (opt-in latency is
// acceptable there), mirroring the tradeoff Sentry already makes in this file
// for the same reason.
//
// See docs/content/reference/environment-variables.mdx ("OTel trace export")
// and plans/39-otel-trace-export.md.

import type { Tracer } from '@opentelemetry/api'

import {
  buildOtelResourceAttributes,
  parseOtelExporterUrl,
} from './otel-options'
import { warn } from '@chm/logger'
import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { getEdition } from '@/lib/edition'

const TRACER_NAME = 'chmonitor'

type EnvBindings = Record<string, string | undefined>

interface OtelState {
  tracer: Tracer | undefined
  provider: BasicTracerProvider | undefined
}

let state: OtelState | undefined
let loggedInvalidUrl = false

function readEnv(
  env: EnvBindings | undefined,
  key: string
): string | undefined {
  return env?.[key] ?? process.env[key]
}

/**
 * Resolve (and lazily build, once) the OTel tracer for chmonitor's own query
 * spans. Returns `undefined` when CHM_OTEL_EXPORTER_URL is unset or invalid —
 * callers MUST treat `undefined` as "tracing disabled" (see with-span.ts).
 *
 * Memoized for the lifetime of the isolate/process. The first call is always
 * the request-middleware root span in start.ts, which has the Worker `env`
 * binding; later calls from deeper code (e.g. the query executor, which has
 * no `env` handy) just reuse the cached result.
 */
export function getOtelTracer(env?: EnvBindings): Tracer | undefined {
  if (state) return state.tracer

  const rawUrl = readEnv(env, 'CHM_OTEL_EXPORTER_URL')
  const url = parseOtelExporterUrl(rawUrl)
  if (!url) {
    if (rawUrl && !loggedInvalidUrl) {
      loggedInvalidUrl = true
      warn(
        '[otel] CHM_OTEL_EXPORTER_URL is set but is not an absolute http(s) URL; trace export stays disabled.'
      )
    }
    state = { tracer: undefined, provider: undefined }
    return undefined
  }

  const resource = resourceFromAttributes(
    buildOtelResourceAttributes({
      version: import.meta.env.VITE_GIT_SHA,
      edition: getEdition(env),
    })
  )

  const exporter = new OTLPTraceExporter({ url })
  const processor = new BatchSpanProcessor(exporter, {
    // A dashboard request produces at most a handful of query spans, so a
    // small batch size is enough to export them together. forceFlushOtel()
    // (called at the end of every request, see start.ts) does the real work;
    // the scheduled delay below is just a safety net for cases where nothing
    // explicitly flushes (e.g. a crashed process).
    maxExportBatchSize: 64,
    scheduledDelayMillis: 1000,
  })

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [processor],
  })

  // Real ambient context propagation — so the `clickhouse-query` child span
  // created deep inside the query executor picks up the `dashboard-request`
  // root span started in start.ts — requires a registered ContextManager; the
  // default no-op manager does not track "active" context at all. Cloudflare
  // Workers support AsyncLocalStorage under the nodejs_compat flag (already
  // proven in this codebase: @sentry/cloudflare relies on the same primitive
  // for its own per-request scope isolation). Only registered on this
  // (enabled) path — the disabled/default path never touches the global
  // context registry.
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable()
  )

  state = {
    tracer: provider.getTracer(TRACER_NAME),
    provider,
  }
  return state.tracer
}

/**
 * Flush any buffered spans. No-op when tracing is disabled or not yet
 * initialized. Must be awaited inline before a Worker response returns (see
 * module doc above) since there is no `waitUntil` available here.
 */
export async function forceFlushOtel(): Promise<void> {
  if (!state?.provider) return
  try {
    await state.provider.forceFlush()
  } catch (err) {
    warn('[otel] forceFlush failed', { err })
  }
}

/**
 * Test-only: reset the memoized singleton (and the global context manager)
 * so tests can exercise both the disabled and enabled paths in the same file.
 */
export function __resetOtelForTests(): void {
  state = undefined
  loggedInvalidUrl = false
  context.disable()
}
