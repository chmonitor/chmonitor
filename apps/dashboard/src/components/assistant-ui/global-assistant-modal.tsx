'use client'

/**
 * App-wide floating agent, mounted in the dashboard layout.
 *
 * Lazy-loaded via React.lazy so the assistant-ui runtime, the Thread, and the
 * localStorage / D1 thread-list adapter land in a client-only chunk and never
 * enter the Cloudflare Worker server bundle (which has a 3 MiB limit). The
 * `/agents` page applies the same pattern via `agents-page-client.tsx`.
 *
 * Hidden on `/agents`, where the full-page agent already owns the surface and
 * a floating bubble would just duplicate it.
 *
 * Wrapped in an error boundary: this widget renders on every dashboard page,
 * so a failure inside the agent runtime must never take the host page down.
 */

import { ErrorBoundary } from 'react-error-boundary'

import { lazy, Suspense } from 'react'
import { useLocation } from '@tanstack/react-router'

const GlobalAssistantModalImpl = lazy(async () => {
  const m = await import(
    '@/components/assistant-ui/global-assistant-modal-impl'
  )
  return { default: m.GlobalAssistantModalImpl }
})

export function GlobalAssistantModal() {
  const pathname = useLocation({ select: (l) => l.pathname })
  if (pathname === '/agents' || pathname?.startsWith('/agents/')) {
    return null
  }

  return (
    <ErrorBoundary fallbackRender={() => null}>
      <Suspense fallback={null}>
        <GlobalAssistantModalImpl />
      </Suspense>
    </ErrorBoundary>
  )
}
