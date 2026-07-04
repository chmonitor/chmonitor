import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { initAnalyticsClient } from './lib/analytics/analytics'
import { routeTree } from './routeTree.gen'
import { NotFound } from '@/components/not-found'

export function getRouter() {
  // Browser-only PostHog init (no-op on the server, and a no-op client-side
  // without VITE_ANALYTICS_KEY). See lib/analytics/analytics.
  initAnalyticsClient()

  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  })
}
