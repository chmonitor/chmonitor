import { createFileRoute } from '@tanstack/react-router'

import { QueryPageLayout } from '@/components/layout/query-page'
import { RelatedPagesLink } from '@/components/navigation/related-pages-link'
import { tablesOverviewConfig } from '@/lib/query-config/tables/tables-overview'

function TablesOverviewPage() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex justify-end">
        <RelatedPagesLink href="/tables-overview" />
      </div>
      <QueryPageLayout
        queryConfig={tablesOverviewConfig}
        title="Tables Overview"
      />
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/tables-overview')({
  component: TablesOverviewPage,
})
