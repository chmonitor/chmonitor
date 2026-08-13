import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Suspense, useEffect } from 'react'
import { ChartSkeleton } from '@/components/skeletons'
import { splitHref } from '@/lib/url/url-builder'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

/**
 * Legacy route. ZooKeeper monitoring moved under the dedicated "Keeper" menu
 * section at `/keeper`. Redirect client-side (static site — no server
 * redirects) while preserving the `?path=` query param so existing bookmarks
 * keep working.
 */
function ZookeeperRedirect() {
  const navigate = useNavigate()
  const searchParams = useUrlSearchParams()

  useEffect(() => {
    const query = searchParams.toString()
    navigate({
      ...splitHref(`/keeper${query ? `?${query}` : '?path=/'}`),
      replace: true,
    })
  }, [navigate, searchParams])

  return <ChartSkeleton />
}

function ZookeeperPage() {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <ZookeeperRedirect />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/zookeeper')({
  component: ZookeeperPage,
})
