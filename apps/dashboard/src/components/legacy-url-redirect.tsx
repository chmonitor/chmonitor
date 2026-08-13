import { useEffect } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { splitHref } from '@/lib/url/url-builder'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

/**
 * Detects and redirects from legacy URL format:
 * Old: /{hostId}/{route}?{existingParams}
 * New: /{route}?host={hostId}&{existingParams}
 *
 * Handles ALL routes matching /{number}/{path} pattern.
 * Preserves existing query parameters while adding host param.
 */
export function LegacyUrlRedirect() {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()

  useEffect(() => {
    // Pattern: /{number}/{anything}
    const legacyMatch = pathname.match(/^\/(\d+)\/(.+)$/)

    if (legacyMatch) {
      const [, hostId, route] = legacyMatch

      // Preserve existing query params
      const params = new URLSearchParams(searchParams.toString())
      params.set('host', hostId)

      const queryString = params.toString()
      const newUrl = `/${route}${queryString ? `?${queryString}` : ''}`

      navigate({ ...splitHref(newUrl), replace: true })
    }
  }, [pathname, searchParams, navigate])

  return null
}
