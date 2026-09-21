import { createFileRoute } from '@tanstack/react-router'

import { FirstRunEmptyState } from '@/components/host/first-run-empty-state'
import { pageOgHead } from '@/lib/og'

/**
 * Standalone setup / "Connect a host" page.
 *
 * Renders the same welcome/setup surface that `FirstRunGate` shows on first run,
 * but as a permanently reachable route — so a signed-in cloud user can add
 * another host at any time, and the onboarding design has a stable URL.
 * `FirstRunEmptyState` adapts its content to the deployment + auth state
 * (cloud signed-in / cloud anonymous / self-hosted).
 */
export const Route = createFileRoute('/(dashboard)/setup')({
  component: FirstRunEmptyState,
  head: () => pageOgHead('setup'),
})
