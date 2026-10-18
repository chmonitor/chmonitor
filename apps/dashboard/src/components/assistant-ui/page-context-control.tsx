'use client'

/**
 * Surfaces the floating agent's `pageContext` to the composer as a dismissible
 * chip and lets the user switch it off for the current page.
 *
 * Two consumers sit in different parts of the tree, so the state lives here:
 *  - the composer chip (`-thread/page-context-chip.tsx`) reads `pageContext` /
 *    `enabled` and calls `disable()`;
 *  - the chat transport reads `enabledRef.current` at send time (a ref so a
 *    toggle never rebuilds the transport — same trick as `lastSentPathnameRef`).
 *
 * Mounted ONLY around the floating modal (`global-assistant-modal-impl.tsx`).
 * The full `/agents` page has no provider, so `usePageContextControl()` returns
 * `null` there (chip hidden, transport keeps its default send behaviour).
 */

import { useLocation } from '@tanstack/react-router'

import {
  createContext,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { buildPageContext, type PageContext } from '@/lib/ai/agent/page-context'

export interface PageContextControl {
  pageContext: PageContext | null
  enabled: boolean
  /** Re-arms on navigation. */
  disable: () => void
  /**
   * Live view of `enabled` for the transport to read at send time without
   * being a memo dependency (so toggling never rebuilds the transport).
   */
  enabledRef: MutableRefObject<boolean>
}

const PageContextControlContext = createContext<PageContextControl | null>(null)

export function PageContextControlProvider({
  children,
}: {
  children: ReactNode
}) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const pageContext = useMemo(
    () => (pathname ? buildPageContext(pathname) : null),
    [pathname]
  )

  // Track the path the chip was dismissed for (rather than a boolean), so
  // context automatically re-arms when the user navigates elsewhere — a new
  // page is fresh context worth showing again.
  const [dismissedPath, setDismissedPath] = useState<string | null>(null)
  const enabled = pathname !== dismissedPath

  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const value = useMemo<PageContextControl>(
    () => ({
      pageContext,
      enabled,
      disable: () => setDismissedPath(pathname),
      enabledRef,
    }),
    [pageContext, enabled, pathname]
  )

  return (
    <PageContextControlContext.Provider value={value}>
      {children}
    </PageContextControlContext.Provider>
  )
}

/** `null` when no provider is mounted (the full `/agents` page): no page-context UI. */
export function usePageContextControl(): PageContextControl | null {
  return useContext(PageContextControlContext)
}
