import { createRouter as createTanstackRouter } from '@tanstack/react-router'

import { initAnalyticsClient } from './lib/analytics/analytics'
import { initSentryClient } from './lib/observability/sentry'
import { registerStaleChunkReload } from './lib/stale-chunk-reload'
import { routeTree } from './routeTree.gen'

// Shared router factory consumed by both the server and client entries that
// TanStack Start generates. The export MUST be named `getRouter` — Start's
// hydration entry (#tanstack-router-entry → this file) imports `{ getRouter }`.
// The `Register` augmentation makes every route's params/search types
// inferable app-wide.
export function getRouter() {
  // Recover from stale chunk hashes after a deploy (client-only, idempotent).
  registerStaleChunkReload()

  // Browser-only Sentry init (no-op on the server). See lib/observability/sentry.
  initSentryClient()

  // Browser-only product analytics init (no-op on the server, and a no-op
  // client-side without VITE_ANALYTICS_KEY). See lib/analytics/analytics.
  initAnalyticsClient()

  return createTanstackRouter({
    routeTree,
    scrollRestoration: true,
    // No trailing-slash redirect (the old Next app served `/overview` directly).
    // Default behaviour 301/308-redirects `/overview` → `/overview/`, adding
    // ~55-60 ms TTFB to every page load; `'never'` strips it so routes resolve
    // without the round-trip.
    trailingSlash: 'never',
    // Preload route data and code on hover/focus so navigations feel instant.
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
