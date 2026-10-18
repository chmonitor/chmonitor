'use client'

import type { JSX } from 'react'

import { lazy, Suspense } from 'react'
import { AgentsPageSkeleton } from '@/components/skeletons'

/**
 * Client entry point for the `/agents` route. The assistant-ui runtime, the
 * conversation thread-list adapter and `localStorage` are all browser-only, so
 * the page is loaded lazily (no SSR).
 */
const AgentThreadPage = lazy(() =>
  import('@/components/assistant-ui/agent-thread-page').then((m) => ({
    default: m.AgentThreadPage,
  }))
)

export function AgentsPageClient(): JSX.Element {
  // Same footprint as AgentThreadPage (composer + 320px sidebar) so nothing shifts when the chunk mounts.
  return (
    <Suspense fallback={<AgentsPageSkeleton />}>
      <AgentThreadPage />
    </Suspense>
  )
}
