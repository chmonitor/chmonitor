// Product analytics (PostHog) for the blog. OFF by default — a hard no-op
// unless PUBLIC_ANALYTICS_KEY is set. Respects the browser Do Not Track signal.
// Cookieless (localStorage persistence) — no cookie-banner required.
//
// Full-capture config: autocapture + automatic pageview/pageleave are ON so
// blog readership is tracked end-to-end; session recording stays off. Mirrors
// apps/landing/src/lib/analytics.ts (same posture, separate surface).

function isBrowserDoNotTrack(): boolean {
  return typeof navigator !== 'undefined' && navigator.doNotTrack === '1'
}

/** Initialize PostHog once. A no-op without a key, or when DNT is set. */
export async function initAnalytics(): Promise<void> {
  const key = import.meta.env.PUBLIC_ANALYTICS_KEY as string | undefined
  if (!key?.trim() || isBrowserDoNotTrack()) return

  const { default: posthog } = await import('posthog-js')
  posthog.init(key, {
    api_host:
      (import.meta.env.PUBLIC_ANALYTICS_HOST as string | undefined) ||
      'https://us.i.posthog.com',
    persistence: 'localStorage',
    autocapture: true,
    // 'history_change' captures the initial load and any client-side
    // navigation. See posthog-js docs.
    capture_pageview: 'history_change',
    capture_pageleave: 'if_capture_pageview',
    disable_session_recording: true,
  })
}
