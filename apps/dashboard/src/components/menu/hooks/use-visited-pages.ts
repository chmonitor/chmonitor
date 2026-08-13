/**
 * Hook for tracking visited pages using cookies
 *
 * Used to hide "New" badges after a user visits a page
 */

import { useEffect, useState } from 'react'
import { useLocation } from '@tanstack/react-router'

const COOKIE_NAME = 'visited_pages'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Get visited pages from cookie
 */
function getVisitedPages(): Set<string> {
  if (typeof document === 'undefined') return new Set()

  const cookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`))

  if (!cookie) return new Set()

  try {
    const value = decodeURIComponent(cookie.split('=')[1])
    return new Set(JSON.parse(value))
  } catch {
    return new Set()
  }
}

/**
 * Save visited pages to cookie
 */
function saveVisitedPages(pages: Set<string>): void {
  if (typeof document === 'undefined') return

  const value = JSON.stringify([...pages])
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

/**
 * Hook to check if a page has been visited and mark pages as visited
 */
export function useVisitedPages() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const [visitedPages, setVisitedPages] = useState<Set<string>>(() => new Set())

  // Load visited pages from cookie on mount
  useEffect(() => {
    setVisitedPages(getVisitedPages())
  }, [])

  // Mark current page as visited when pathname changes
  useEffect(() => {
    if (!pathname) return

    // Normalize pathname (remove query params and trailing slash)
    const normalizedPath = pathname.replace(/\/$/, '') || '/'

    setVisitedPages((prev) => {
      if (prev.has(normalizedPath)) return prev

      const newSet = new Set(prev)
      newSet.add(normalizedPath)
      saveVisitedPages(newSet)
      return newSet
    })
  }, [pathname])

  const isVisited = (href: string): boolean => {
    // Normalize href
    const normalizedHref = href.replace(/\/$/, '') || '/'
    return visitedPages.has(normalizedHref)
  }

  const markAsVisited = (href: string): void => {
    const normalizedHref = href.replace(/\/$/, '') || '/'
    setVisitedPages((prev) => {
      if (prev.has(normalizedHref)) return prev

      const newSet = new Set(prev)
      newSet.add(normalizedHref)
      saveVisitedPages(newSet)
      return newSet
    })
  }

  return { isVisited, markAsVisited, visitedPages }
}

/**
 * Check if a page should show the "New" badge
 * Returns true if the page is marked as new AND hasn't been visited
 */
export function useShowNewBadge(href: string, isNew?: boolean): boolean {
  const { isVisited } = useVisitedPages()

  if (!isNew) return false
  return !isVisited(href)
}
