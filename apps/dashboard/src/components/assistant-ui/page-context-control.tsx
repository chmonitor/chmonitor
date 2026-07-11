'use client'

/**
 * Shared control for the floating agent's "current page" awareness.
 *
 * The floating widget grounds an ambiguous question ("why is this slow?") in the
 * page the user is on by attaching `pageContext` to the chat request (see
 * `agent-runtime-provider.tsx` + the server route's `sanitizePageContext`). This
 * provider surfaces that same context to the composer so the user can SEE it as
 * a dismissible chip, and lets them switch it off for the current page.
 *
 * Two consumers sit in different parts of the tree, so the state lives here:
 *  - the composer chip (`-thread/page-context-chip.tsx`) reads `pageContext` /
 *    `enabled` and calls `disable()`;
 *  - the chat transport reads `enabledRef.current` at send time (a ref so a
 *    toggle never rebuilds the transport — same trick as `lastSentPathnameRef`).
 *
 * Mounted ONLY around the floating modal (`global-assistant-modal-impl.tsx`).
 * The full `/agents` page has no provider, so `usePageContextControl()` returns
 * `null` there and both consumers behave exactly as before (chip hidden,
 * transport keeps its default send behaviour).
 */

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
import { usePathname } from '@/lib/next-compat'

export interface PageContextControl {
  /** Current page context, or `null` when the route can't be resolved. */
  pageContext: PageContext | null
  /** Whether page context will ride along with the next message. */
  enabled: boolean
  /** Drop page context (user dismissed the chip). Re-arms on navigation. */
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
  const pathname = usePathname()
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

/**
 * Access the floating widget's page-context control. Returns `null` when no
 * provider is mounted (e.g. the full `/agents` page) — callers must treat that
 * as "no page-context UI, default transport behaviour".
 */
export function usePageContextControl(): PageContextControl | null {
  return useContext(PageContextControlContext)
}
