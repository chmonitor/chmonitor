// Server-side (Cloudflare Worker) PostHog capture.
//
// The dashboard Worker runs on workerd, not Node — the same constraint that
// forced @sentry/cloudflare over @sentry/node (see sentry.server.ts). The
// `posthog-node` SDK batches events with background timers that outlive the
// request and do not fit the Worker request/response lifecycle, so this module
// talks to PostHog's stateless `/capture/` HTTP endpoint directly with `fetch`.
//
// OFF by default: a hard no-op unless CHM_ANALYTICS_KEY is present in the Worker
// env — self-hosted instances never phone home to a third-party analytics
// platform without an explicit opt-in key (mirrors the client gate).

import type { AnalyticsProps } from './events'

import { redactProps } from '@/lib/telemetry/redact'

const DEFAULT_HOST = 'https://us.i.posthog.com'

/** Read the analytics key/host from the Worker env. Empty key → disabled. */
function resolveServerAnalytics(env: Record<string, string | undefined>): {
  key: string
  host: string
} | null {
  const key = env.CHM_ANALYTICS_KEY?.trim()
  if (!key) return null
  return { key, host: env.CHM_ANALYTICS_HOST?.trim() || DEFAULT_HOST }
}

/**
 * Fire-and-forget capture of a single server event. Returns the in-flight
 * promise so callers can `ctx.waitUntil()` it when an ExecutionContext is
 * available; otherwise it may be awaited or left to run inline. Never throws —
 * analytics failures must not affect request handling.
 */
export function captureServerEvent(
  env: Record<string, string | undefined>,
  event: string,
  props: AnalyticsProps = {},
  distinctId = 'server'
): Promise<void> {
  const cfg = resolveServerAnalytics(env)
  if (!cfg) return Promise.resolve()

  return fetch(`${cfg.host}/capture/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: cfg.key,
      event,
      distinct_id: distinctId,
      properties: { $lib: 'chm-worker', ...redactProps(props) },
    }),
  })
    .then(() => undefined)
    .catch(() => undefined)
}

/**
 * Capture a server-side crash as a PostHog `$exception`. No-op when analytics
 * is disabled. Only the error name/message and caller-supplied (redacted) props
 * are sent — never stack contents that could carry PII.
 */
export function captureServerException(
  env: Record<string, string | undefined>,
  error: unknown,
  props: AnalyticsProps = {}
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error))
  return captureServerEvent(env, '$exception', {
    $exception_type: err.name,
    $exception_message: err.message,
    ...props,
  })
}
