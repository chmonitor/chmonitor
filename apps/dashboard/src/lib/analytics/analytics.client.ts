// Browser-side PostHog init. Imported ONLY behind a `typeof document` guard +
// dynamic import() in analytics.ts, so posthog-js never lands in the
// size-constrained Cloudflare Worker SSR bundle (#1393) — mirrors
// lib/observability/sentry.client.ts.
//
// Disabled (no-op) unless VITE_ANALYTICS_KEY is set — analytics is OFF by
// default for self-hosted instances. Also a hard no-op when the browser's Do
// Not Track signal is set, or the DO_NOT_TRACK env convention opts out.
//
// Locked-down PostHog config: no autocapture (would capture form/input/text
// content — a PII vector), no automatic pageview/pageleave capture (funnel
// pages are tracked explicitly), no session recording, cookieless
// (localStorage) persistence so there is no cookie-banner requirement.
// distinct_id stays PostHog's anonymous default — this app never calls
// identify() with anything user-derived.

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
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  })
  posthogInstance = posthog

  for (const { event, props } of pending.splice(0)) {
    posthog.capture(event, redactProps(props))
  }
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
