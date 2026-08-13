import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { Suspense, useEffect } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { splitHref } from '@/lib/url/url-builder'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

function TableRedirect() {
  const navigate = useNavigate()
  const searchParams = useUrlSearchParams()

  useEffect(() => {
    const params = new URLSearchParams()
    const host = searchParams.get('host')
    const database = searchParams.get('database')
    const table = searchParams.get('table')

    if (host) params.set('host', host)
    if (database) params.set('database', database)
    if (table) params.set('table', table)

    navigate({
      ...splitHref(`/explorer?${params.toString()}`),
      replace: true,
    })
  }, [searchParams, navigate])

  return (
    <div className="flex h-96 items-center justify-center">
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

function TablePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-96 items-center justify-center">
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      }
    >
      <TableRedirect />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/table')({
  component: TablePage,
})
