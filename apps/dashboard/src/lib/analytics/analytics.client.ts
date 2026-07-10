// Browser-side PostHog init. Imported ONLY behind a `typeof document` guard +
// dynamic import() in analytics.ts, so posthog-js never lands in the
// size-constrained Cloudflare Worker SSR bundle (#1393) — mirrors
// lib/observability/sentry.client.ts.
//
// Disabled (no-op) unless VITE_ANALYTICS_KEY is set — analytics is OFF by
// default for self-hosted instances. Also a hard no-op when the browser's Do
// Not Track signal is set, or the DO_NOT_TRACK env convention opts out.
//
// Full-capture PostHog config: autocapture (clicks, form submits), automatic
// pageview + pageleave, and manual exception capture are all ON so the product
// team gets end-to-end product analytics. Session recording stays OFF, and
// persistence stays cookieless (localStorage) so there is still no cookie-banner
// requirement. distinct_id stays PostHog's anonymous default — this app never
// calls identify() with anything user-derived. NOTE: autocapture can record the
// text of clicked elements; the two rails above (off-by-default key gate + Do
// Not Track) keep self-hosted instances silent by default.

import type { AnalyticsEvent, AnalyticsProps } from './events'

import { isAnalyticsEnabled } from './config'
import { redactProps } from '@/lib/telemetry/redact'

interface PendingEvent {
  event: AnalyticsEvent
  props: AnalyticsProps
}

type PostHogModule = typeof import('posthog-js').default

let posthogInstance: PostHogModule | null = null
let initStarted = false
let disabled = false
// Bounded so a caller that fires events before init resolves (or when
// analytics is never initialized at all) cannot grow this unboundedly.
const MAX_PENDING = 20
const pending: PendingEvent[] = []

/** Initialize the browser SDK once. Safe to call repeatedly. */
export async function initAnalyticsClient(): Promise<void> {
  if (initStarted) return
  initStarted = true
  // Never run on the server — the isomorphic wrapper in analytics.ts already
  // guarantees this, but guard defensively since this module can be imported
  // directly in tests.
  if (typeof document === 'undefined') return

  const key = import.meta.env.VITE_ANALYTICS_KEY
  if (
    !isAnalyticsEnabled({
      key,
      envDoNotTrack: import.meta.env.VITE_DO_NOT_TRACK,
    })
  ) {
    disabled = true
    return
  }

  const { default: posthog } = await import('posthog-js')
  posthog.init(key as string, {
    api_host: import.meta.env.VITE_ANALYTICS_HOST || 'https://us.i.posthog.com',
    persistence: 'localStorage',
    autocapture: true,
    // 'history_change' (not boolean true) so SPA route changes fire $pageview —
    // boolean true only captures the initial hard load. See posthog-js docs.
    capture_pageview: 'history_change',
    capture_pageleave: 'if_capture_pageview',
    disable_session_recording: true,
  })
  posthogInstance = posthog

  for (const { event, props } of pending.splice(0)) {
    posthog.capture(event, redactProps(props))
  }
}

/**
 * Report a client-side crash to PostHog (`$exception`). A no-op when analytics
 * is disabled or not yet initialized, so call sites need no guard of their own.
 * Called from the React error boundaries alongside the Sentry report.
 */
export function captureAnalyticsException(
  error: unknown,
  context?: AnalyticsProps
): void {
  if (disabled || !posthogInstance) return
  posthogInstance.captureException(
    error,
    context ? redactProps(context) : undefined
  )
}

/**
 * Track a funnel event. A no-op when analytics is disabled, so call sites
 * need no guard of their own. If init hasn't resolved yet, the event is
 * queued and flushed once PostHog is ready. Props are redacted defensively
 * (reusing the telemetry redactor) before leaving the process.
 */
export function trackAnalyticsEvent(
  event: AnalyticsEvent,
  props: AnalyticsProps = {}
): void {
  if (disabled) return
  if (posthogInstance) {
    posthogInstance.capture(event, redactProps(props))
    return
  }
  if (pending.length < MAX_PENDING) pending.push({ event, props })
}

/**
 * The browser's PostHog anonymous distinct-id, or undefined when analytics is
 * disabled or PostHog hasn't finished initializing yet. Used to stitch
 * server-side funnel events (e.g. `upgrade_completed` from the Polar webhook,
 * #2478) onto the same distinct-id as the rest of the browser funnel.
 */
export function getAnalyticsDistinctId(): string | undefined {
  if (disabled || !posthogInstance) return undefined
  return posthogInstance.get_distinct_id()
}
