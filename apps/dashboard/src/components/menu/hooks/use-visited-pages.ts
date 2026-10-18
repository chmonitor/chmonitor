import { useLocation } from '@tanstack/react-router'

import { useEffect, useState } from 'react'

const COOKIE_NAME = 'visited_pages'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

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

function saveVisitedPages(pages: Set<string>): void {
  if (typeof document === 'undefined') return

  const value = JSON.stringify([...pages])
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
}

export function useVisitedPages() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const [visitedPages, setVisitedPages] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setVisitedPages(getVisitedPages())
  }, [])

  useEffect(() => {
    if (!pathname) return

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

export function useShowNewBadge(href: string, isNew?: boolean): boolean {
  const { isVisited } = useVisitedPages()

  if (!isNew) return false
  return !isVisited(href)
}
