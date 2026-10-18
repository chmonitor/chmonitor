import { createFileRoute } from '@tanstack/react-router'

import { FirstRunEmptyState } from '@/components/host/first-run-empty-state'
import { pageOgHead } from '@/lib/og'

/**
 * Standalone "Connect a host" page: the `FirstRunGate` welcome surface as a
 * permanently reachable route, so a signed-in cloud user can add another host.
 */
export const Route = createFileRoute('/(dashboard)/setup')({
  component: FirstRunEmptyState,
  head: () => pageOgHead('setup'),
})
