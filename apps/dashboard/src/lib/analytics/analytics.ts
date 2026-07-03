// Isomorphic entry points for browser-side product analytics (PostHog). The
// real implementation lives in `analytics.client.ts` (the `.client` suffix
// marks it browser-only). Importing a `.client` module directly from
// server-reachable code trips TanStack Start's import-protection, so every
// caller goes through these `createIsomorphicFn().client()` wrappers instead:
// the client body — including the dynamic import of posthog-js — is stripped
// from the SERVER build, keeping it out of the size-constrained Worker SSR
// bundle (#1393). Mirrors lib/observability/sentry.ts.

import { createIsomorphicFn } from '@tanstack/react-start'

import type { AnalyticsEvent, AnalyticsProps } from './events'

/** Initialize PostHog as early as possible. No-op on the server. */
export const initAnalyticsClient = createIsomorphicFn().client(() => {
  void import('./analytics.client').then((m) => m.initAnalyticsClient())
})

/**
 * Track a funnel event. No-op on the server, and a no-op client-side unless
 * analytics is configured (VITE_ANALYTICS_KEY) and Do Not Track is not set.
 */
export const trackEvent = createIsomorphicFn().client(
  (event: AnalyticsEvent, props?: AnalyticsProps) => {
    void import('./analytics.client').then((m) =>
      m.trackAnalyticsEvent(event, props)
    )
  }
)
