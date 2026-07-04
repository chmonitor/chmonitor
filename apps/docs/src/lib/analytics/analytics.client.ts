// Browser-side PostHog init for the docs site. Imported ONLY behind a dynamic
// import() from analytics.ts, so posthog-js never lands in the size-constrained
// Cloudflare Worker SSR bundle — mirrors apps/dashboard/src/lib/analytics.
//
// Disabled (no-op) unless VITE_ANALYTICS_KEY is set, and a hard no-op when the
// browser's Do Not Track signal is set. Full-capture config: autocapture +
// automatic pageview/pageleave are ON so docs usage is tracked end-to-end.
// Session recording stays OFF and persistence is cookieless (localStorage) so
// there is no cookie-banner requirement.

let initialized = false

function isBrowserDoNotTrack(): boolean {
  return typeof navigator !== 'undefined' && navigator.doNotTrack === '1'
}

/** Initialize the browser SDK once. Safe to call repeatedly. */
export async function initAnalyticsClient(): Promise<void> {
  if (initialized) return
  if (typeof document === 'undefined') return

  const key = import.meta.env.VITE_ANALYTICS_KEY
  if (!key?.trim() || isBrowserDoNotTrack()) return
  initialized = true

  const { default: posthog } = await import('posthog-js')
  posthog.init(key, {
    api_host: import.meta.env.VITE_ANALYTICS_HOST || 'https://us.i.posthog.com',
    persistence: 'localStorage',
    autocapture: true,
    // 'history_change' so SPA route changes fire $pageview (boolean true only
    // captures the initial hard load). See posthog-js docs.
    capture_pageview: 'history_change',
    capture_pageleave: 'if_capture_pageview',
    disable_session_recording: true,
  })
}
