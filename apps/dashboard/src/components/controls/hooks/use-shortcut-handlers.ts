/**
 * Shortcut handler hooks for keyboard navigation
 *
 * Provides navigation handlers for keyboard shortcuts.
 */

import { useNavigate } from '@tanstack/react-router'

import { useHostId } from '@/lib/swr'
import { buildUrl, splitHref } from '@/lib/url/url-builder'

/**
 * Navigation handlers for keyboard shortcuts
 */
export function useShortcutHandlers() {
  const navigate = useNavigate()
  const hostId = useHostId()

  const goToOverview = () => {
    navigate(splitHref(buildUrl('/overview', { host: hostId })))
  }

  const goToQueries = () => {
    navigate(splitHref(buildUrl('/running-queries', { host: hostId })))
  }

  const goToTables = () => {
    navigate(splitHref(buildUrl('/tables', { host: hostId })))
  }

  const triggerRevalidate = () => {
    // Trigger SWR revalidation by dispatching a custom event
    window.dispatchEvent(new CustomEvent('swr:revalidate'))
  }

  return {
    goToOverview,
    goToQueries,
    goToTables,
    triggerRevalidate,
  }
}
