/**
 * React binding for the pinned-favorites store (issue #2769). Thin
 * `useSyncExternalStore` wrapper — mirrors `usePaywall()` in
 * `components/billing/paywall-host.tsx`.
 */

import { useCallback, useSyncExternalStore } from 'react'
import {
  getFavoriteHrefs,
  getFavoritesServerSnapshot,
  reorderFavorites,
  subscribeFavorites,
  toggleFavorite,
} from '@/lib/menu/favorites-store'

/** Pinned hrefs in pin order (user-reorderable; new pins append). */
export function useFavoriteHrefs(): string[] {
  return useSyncExternalStore(
    subscribeFavorites,
    getFavoriteHrefs,
    getFavoritesServerSnapshot
  )
}

export function useIsFavorite(href: string): boolean {
  const hrefs = useFavoriteHrefs()
  return hrefs.includes(href)
}

export function useToggleFavorite(): (href: string) => void {
  return useCallback((href: string) => toggleFavorite(href), [])
}

export function useReorderFavorites(): (
  fromHref: string,
  toHref: string
) => void {
  return useCallback(
    (fromHref: string, toHref: string) => reorderFavorites(fromHref, toHref),
    []
  )
}
