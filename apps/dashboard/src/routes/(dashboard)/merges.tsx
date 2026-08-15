import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton, TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { pageOgHead } from '@/lib/og'
import { mergesConfig } from '@/lib/query-config/merges/merges'
import { recentMergesConfig } from '@/lib/query-config/merges/recent-merges'

function MergesPageContent() {
  return (
    <PageLayout
      queryConfig={mergesConfig}
      title="Merges in progress"
      // system.merges holds ONLY merges running right now, so the table above
      // is empty on any cluster that is not mid-merge — correct ClickHouse
      // behaviour, but it left this page looking broken. The completed-merge
      // history below is what the page shows the rest of the time.
      //
      // It is a separate config rather than a UNION so that part_log staying
      // optional cannot take the live table down with it: part_log is opt-in
      // server config, and `recentMergesConfig` carries optional/tableCheck to
      // degrade to a note of its own when the table is absent.
      footerContent={
        <Suspense fallback={<TableSkeleton />}>
          <TableClient
            title="Recently completed merges"
            description={recentMergesConfig.description}
            queryConfig={recentMergesConfig}
          />
        </Suspense>
      }
    />
  )
}

function MergesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MergesPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/merges')({
  component: MergesPage,
  head: () => pageOgHead('merges'),
})
