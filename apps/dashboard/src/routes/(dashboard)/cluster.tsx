import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useEffect } from 'react'
import { splitHref } from '@/lib/url/url-builder'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

/** Redirect /cluster → /clusters (topology + table merged into one page) */
function ClusterRedirectPage() {
  const navigate = useNavigate()
  const searchParams = useUrlSearchParams()

  useEffect(() => {
    navigate({
      ...splitHref(`/clusters?${searchParams.toString()}`),
      replace: true,
    })
  }, [navigate, searchParams])

  return null
}

export const Route = createFileRoute('/(dashboard)/cluster')({
  component: ClusterRedirectPage,
})
