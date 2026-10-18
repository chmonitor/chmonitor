'use client'

/**
 * App-wide floating agent, mounted in the dashboard layout.
 *
 * The implementation is lazy-loaded so assistant-ui stays out of the
 * Cloudflare Worker server bundle (3 MiB limit).
 *
 * `React.lazy` starts its import as soon as the lazy element is *rendered*,
 * so rendering it unconditionally pulled ~1.3 MB of JS into the initial load
 * of every dashboard page. The collapsed state therefore renders only
 * `AssistantModalButton` (no assistant-ui imports); the real widget mounts on
 * first activation, already open, and the chunk is prefetched on hover/focus.
 *
 * Hidden on `/agents`, where the full-page agent owns the surface.
 *
 * Wrapped in an error boundary: this renders on every dashboard page, so an
 * agent runtime failure must never take the host page down.
 */

import { ErrorBoundary } from 'react-error-boundary'
import { useLocation } from '@tanstack/react-router'

import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { AssistantModalButton } from '@/components/assistant-ui/assistant-modal-button'

const importImpl = () =>
  import('@/components/assistant-ui/global-assistant-modal-impl')

const GlobalAssistantModalImpl = lazy(async () => {
  const m = await importImpl()
  return { default: m.GlobalAssistantModalImpl }
})

export function GlobalAssistantModal() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const [activated, setActivated] = useState(false)
  const prefetched = useRef(false)

  // Guarded by a ref: this re-enters on every pointer event.
  const prefetch = useCallback(() => {
    if (prefetched.current) return
    prefetched.current = true
    void importImpl()
  }, [])

  if (pathname === '/agents' || pathname?.startsWith('/agents/')) {
    return null
  }

  if (!activated) {
    // Mirrors AssistantModal's anchor geometry so the bubble does not shift on handoff.
    return (
      <div className="fixed right-4 bottom-4 z-40 size-11 max-md:landscape:top-16 max-md:landscape:bottom-auto">
        <AssistantModalButton
          onClick={() => setActivated(true)}
          onPointerEnter={prefetch}
          onFocus={prefetch}
        />
      </div>
    )
  }

  return (
    <ErrorBoundary fallbackRender={() => null}>
      <Suspense
        fallback={
          <div className="fixed right-4 bottom-4 z-40 size-11 max-md:landscape:top-16 max-md:landscape:bottom-auto">
            <AssistantModalButton data-state="open" disabled />
          </div>
        }
      >
        <GlobalAssistantModalImpl initialOpen />
      </Suspense>
    </ErrorBoundary>
  )
}
