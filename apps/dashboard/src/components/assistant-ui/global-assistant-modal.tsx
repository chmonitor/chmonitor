'use client'

/**
 * App-wide floating agent, mounted in the dashboard layout.
 *
 * The implementation is lazy-loaded via `React.lazy` so the assistant-ui
 * runtime, the Thread, and the localStorage / D1 thread-list adapter land in a
 * client-only chunk and never enter the Cloudflare Worker server bundle (which
 * has a 3 MiB limit). The `/agents` page applies the same pattern via
 * `agents-page-client.tsx`.
 *
 * `React.lazy` starts its import as soon as the lazy element is *rendered*,
 * though — not when the user opens anything. Rendering it unconditionally
 * therefore pulled ~1.3 MB of JS (the largest chunk in the app: assistant-ui,
 * markdown, KaTeX, syntax highlighting) into the initial load of every
 * dashboard page, for a widget that starts collapsed and is usually never
 * opened.
 *
 * So the collapsed state renders only `AssistantModalButton` — a plain button
 * with no assistant-ui imports — and the real widget mounts on first
 * activation, already open. The chunk is also prefetched on hover/focus, so by
 * the time a deliberate click lands it is usually already in flight.
 *
 * Hidden on `/agents`, where the full-page agent already owns the surface and
 * a floating bubble would just duplicate it.
 *
 * Wrapped in an error boundary: this widget renders on every dashboard page,
 * so a failure inside the agent runtime must never take the host page down.
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

  // Warm the chunk on intent (hover/focus) so the click itself feels instant.
  // Guarded by a ref because the browser will happily re-enter this on every
  // pointer event; the module cache makes repeats cheap, but the guard keeps
  // it to a single call.
  const prefetch = useCallback(() => {
    if (prefetched.current) return
    prefetched.current = true
    void importImpl()
  }, [])

  if (pathname === '/agents' || pathname?.startsWith('/agents/')) {
    return null
  }

  if (!activated) {
    // Mirrors the anchor geometry inside AssistantModal so the bubble does not
    // shift when the real widget takes over.
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
