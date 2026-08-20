import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'

import { useEffect } from 'react'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { getPageTitle } from '@/lib/page-title'
import { visibilityAwareInterval } from '@/lib/swr/config'

const BASE_TITLE = 'chmonitor'
const WARNING_PREFIX = '⚠️ '

interface HealthzResponse {
  ok: boolean
  hosts?: Array<{ status: 'up' | 'down' }>
}

const fetcher = async (url: string): Promise<HealthzResponse> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Healthz fetch failed: ${response.status}`)
  }
  return response.json() as Promise<HealthzResponse>
}

/**
 * Updates document.title dynamically based on active page route and health.
 * Polls /api/healthz every 60 seconds.
 */
export function DynamicTitle() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()

  const { data } = useQuery<HealthzResponse>({
    queryKey: ['/api/healthz'],
    queryFn: () => fetcher('/api/healthz'),
    refetchInterval: visibilityAwareInterval(60_000),
    refetchOnWindowFocus: false,
    retry: 2,
  })

  useEffect(() => {
    const pageTitle = getPageTitle(
      pathname || '/',
      searchParams || new URLSearchParams()
    )
    const fullTitle = `${pageTitle} | ${BASE_TITLE}`
    const isDegraded = data?.ok === false

    document.title = isDegraded ? `${WARNING_PREFIX}${fullTitle}` : fullTitle

    return () => {
      document.title = `${pageTitle} | ${BASE_TITLE}`
    }
  }, [data, pathname, searchParams])

  return null
}
