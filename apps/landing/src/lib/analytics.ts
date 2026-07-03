// Product analytics (PostHog) for the marketing site. OFF by default — a hard
// no-op unless PUBLIC_ANALYTICS_KEY is set. Respects the browser Do Not Track
// signal. Cookieless (localStorage persistence) — no cookie-banner required.
// Autocapture, session recording, and automatic pageview capture are all
// disabled; every event sent by this app is one of the explicit, allowlisted
// calls below.
//
// Counterpart to apps/dashboard/src/lib/analytics/ (same privacy posture, same
// event-catalog philosophy, separate PostHog project). See
// docs/content/operate/advanced/product-analytics.mdx.

export type LandingAnalyticsEvent =
  | 'landing_view'
  | 'pricing_view'
  | 'cta_click'

type LandingAnalyticsProps = Record<string, string>

type PostHogModule = typeof import('posthog-js').default

let posthogInstance: PostHogModule | null = null
let disabled = false
const MAX_PENDING = 20
const pending: {
  event: LandingAnalyticsEvent
  props: LandingAnalyticsProps
}[] = []

function isBrowserDoNotTrack(): boolean {
  return typeof navigator !== 'undefined' && navigator.doNotTrack === '1'
}

/** Initialize PostHog once. A no-op without a key, or when DNT is set. */
export async function initAnalytics(): Promise<void> {
  const key = import.meta.env.PUBLIC_ANALYTICS_KEY as string | undefined
  if (!key?.trim() || isBrowserDoNotTrack()) {
    disabled = true
    return
  }

  const { default: posthog } = await import('posthog-js')
  posthog.init(key, {
    api_host:
      (import.meta.env.PUBLIC_ANALYTICS_HOST as string | undefined) ||
      'https://us.i.posthog.com',
    persistence: 'localStorage',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  })
  posthogInstance = posthog

  for (const { event, props } of pending.splice(0)) {
    posthog.capture(event, props)
  }
}

/** Track a funnel event. A no-op when analytics is disabled. */
export function trackEvent(
  event: LandingAnalyticsEvent,
  props: LandingAnalyticsProps = {}
): void {
  if (disabled) return
  if (posthogInstance) {
    posthogInstance.capture(event, props)
    return
  }
  if (pending.length < MAX_PENDING) pending.push({ event, props })
}

// Only short static identifiers are accepted — e.g. a `data-cta` attribute
// value authored directly in the marketing site's markup. Never derived from
// user input, URLs, or DOM text, so there is nothing to redact.
const SAFE_TARGET_RE = /^[a-z0-9_-]{1,64}$/i

/** Track a CTA click. `target` must be a short static identifier. */
export function trackCtaClick(target: string): void {
  if (!SAFE_TARGET_RE.test(target)) return
  trackEvent('cta_click', { target })
}
