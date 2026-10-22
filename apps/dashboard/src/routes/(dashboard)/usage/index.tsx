import { SearchIcon } from 'lucide-react'
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'

import { Suspense, useEffect, useState } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { Input } from '@/components/ui/input'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import {
  usageByUserConfig,
  usageInactiveUsersConfig,
  usageListSearchParams,
} from '@/lib/query-config/queries/usage'
import { splitHref } from '@/lib/url/url-builder'

/** Server-side name filter; writes `?name_filter=` after a short pause. */
function UserNameFilter({ value }: { value: string }) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (draft === value) return
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams)
      if (draft) next.set('name_filter', draft)
      else next.delete('name_filter')
      navigate({
        ...splitHref(`${pathname}?${next.toString()}`),
        replace: true,
      })
    }, 300)
    return () => clearTimeout(id)
  }, [draft, value, searchParams, pathname, navigate])

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        strokeWidth={1.5}
        aria-hidden
      />
      <Input
        type="search"
        aria-label="Filter users by name"
        placeholder="Filter users by name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 pl-8 text-[13px]"
      />
    </div>
  )
}

function UsageContent() {
  const searchParams = useUrlSearchParams()
  const params = usageListSearchParams(searchParams)

  return (
    <div className="flex flex-col gap-4">
      <UserNameFilter value={params.name_filter ?? ''} />
      <PageLayout
        queryConfig={usageByUserConfig}
        title="Usage by User"
        searchParams={params}
      />
      <Suspense fallback={<TableSkeleton />}>
        <TableClient
          title="Inactive Users"
          description={usageInactiveUsersConfig.description}
          queryConfig={usageInactiveUsersConfig}
          searchParams={params}
        />
      </Suspense>
    </div>
  )
}

function UsagePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/usage/')({
  component: UsagePage,
  head: () => pageOgHead('usage'),
})
