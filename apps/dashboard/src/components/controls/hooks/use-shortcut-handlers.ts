import { useNavigate } from '@tanstack/react-router'

import { useHostId } from '@/lib/swr'
import { buildUrl, splitHref } from '@/lib/url/url-builder'

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
    window.dispatchEvent(new CustomEvent('swr:revalidate'))
  }

  return {
    goToOverview,
    goToQueries,
    goToTables,
    triggerRevalidate,
  }
}
