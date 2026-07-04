// Isomorphic entry point for browser-side product analytics (PostHog). The real
// implementation lives in `analytics.client.ts` (the `.client` suffix marks it
// browser-only). Going through `createIsomorphicFn().client()` strips the client
// body — including the dynamic import of posthog-js — from the SERVER build,
// keeping it out of the size-constrained Worker SSR bundle. Mirrors
// apps/dashboard/src/lib/analytics/analytics.ts.

import { createIsomorphicFn } from '@tanstack/react-start'

/** Initialize PostHog as early as possible. No-op on the server. */
export const initAnalyticsClient = createIsomorphicFn().client(() => {
  void import('./analytics.client').then((m) => m.initAnalyticsClient())
})
