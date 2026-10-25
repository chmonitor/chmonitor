// Browser-side Sentry init. Imported ONLY behind a `typeof document` guard +
// dynamic import() in router.tsx, so @sentry/react never lands in the
// size-constrained Cloudflare Worker SSR bundle (#1393).
//
// Disabled (no-op) unless VITE_SENTRY_DSN is set — the OSS default. The DSN is
// inlined at build time from the canonical CHM_SENTRY_DSN (see vite.config.ts).
//
// @sentry/react (~49 KB) is fetched when the browser is idle, not during first
// paint. Errors raised before it arrives are buffered by two plain listeners
// and by captureClientException, then replayed once Sentry is ready.

import { buildSharedSentryOptions } from './sentry-options'
import { runWhenIdle } from '@/lib/run-when-idle'

type SentryModule = typeof import('@sentry/react')

interface PendingError {
  error: unknown
  context?: Record<string, unknown>
}

const MAX_PENDING = 20

let started = false
let sentry: SentryModule | null = null
const pending: PendingError[] = []

function buffer(error: unknown, context?: Record<string, unknown>): void {
  if (pending.length < MAX_PENDING) pending.push({ error, context })
}

function onEarlyError(event: ErrorEvent): void {
  buffer(event.error ?? event.message)
}

function onEarlyRejection(event: PromiseRejectionEvent): void {
  buffer(event.reason)
}

function send(
  s: SentryModule,
  error: unknown,
  context?: Record<string, unknown>
): void {
  s.captureException(error, context ? { extra: context } : undefined)
}

/** Initialize the browser SDK once. Safe to call repeatedly. */
export function initSentryClient(): void {
  if (started) return
  // Never run on the server — the worker uses @sentry/cloudflare instead.
  if (typeof document === 'undefined') return

  const options = buildSharedSentryOptions({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    release: import.meta.env.VITE_GIT_SHA,
    tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
  })
  if (!options) return // no DSN → Sentry disabled

  started = true
  window.addEventListener('error', onEarlyError)
  window.addEventListener('unhandledrejection', onEarlyRejection)

  runWhenIdle(() => {
    void import('@sentry/react')
      .then((s) => {
        s.init({
          ...options,
          integrations: [s.browserTracingIntegration()],
        })
        // Sentry's own global handlers take over from here.
        window.removeEventListener('error', onEarlyError)
        window.removeEventListener('unhandledrejection', onEarlyRejection)
        sentry = s
        for (const { error, context } of pending.splice(0)) {
          send(s, error, context)
        }
      })
      .catch(() => {
        // Chunk failed to load (offline, stale deploy). Error reporting is best
        // effort; never let it surface as an error of its own.
      })
  })
}

/**
 * Report an error to Sentry from a React error boundary. A no-op when Sentry is
 * disabled, so call sites need no guard of their own. Buffered until the SDK
 * has loaded.
 */
export function captureClientException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!started) return
  if (sentry) {
    send(sentry, error, context)
    return
  }
  buffer(error, context)
}
