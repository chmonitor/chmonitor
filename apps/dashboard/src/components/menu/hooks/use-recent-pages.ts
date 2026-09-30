/**
 * React binding for the recent-pages store (`lib/menu/recent-pages.ts`).
 */

import { useLocation } from '@tanstack/react-router'

import { useEffect, useSyncExternalStore } from 'react'
import {
  getRecentPagesServerSnapshot,
  getRecentPagesSnapshot,
  type RecentPage,
  recordRecentPage,
  subscribeRecentPages,
} from '@/lib/menu/recent-pages'

export function useRecentPages(): readonly RecentPage[] {
  return useSyncExternalStore(
    subscribeRecentPages,
    getRecentPagesSnapshot,
    getRecentPagesServerSnapshot
  )
}

/**
 * Records the current pathname as the newest visit. Safe to mount in many
 * places: recording the page that is already newest is a no-op.
 */
export function useRecordRecentPage(): void {
  const pathname = useLocation({ select: (l) => l.pathname })
  useEffect(() => {
    if (pathname) recordRecentPage(pathname)
  }, [pathname])
}
