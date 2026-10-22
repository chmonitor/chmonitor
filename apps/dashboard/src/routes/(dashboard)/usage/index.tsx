import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { pageOgHead } from '@/lib/og'
import {
  usageByUserConfig,
  usageInactiveUsersConfig,
} from '@/lib/query-config/queries/usage'

function UsageContent() {
  const searchParams = useUrlSearchParams()
  const days = searchParams.get('days') ?? usageByUserConfig.defaultParams?.days

  return (
    <div className="flex flex-col gap-4">
      <PageLayout queryConfig={usageByUserConfig} title="Usage by User" />
      <Suspense fallback={<TableSkeleton />}>
        <TableClient
          title="Inactive Users"
          description={usageInactiveUsersConfig.description}
          queryConfig={usageInactiveUsersConfig}
          searchParams={days ? { days } : {}}
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
