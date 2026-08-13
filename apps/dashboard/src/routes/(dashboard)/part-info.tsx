import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { DatabaseTableSelector } from '@/components/controls/database-table-selector'
import { TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/empty-state'
import { partInfoConfig } from '@/lib/query-config/tables/part-info'
import { useHostId } from '@/lib/swr'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

function PartInfoContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const database = searchParams.get('database')
  const table = searchParams.get('table')

  const explorerUrl =
    database && table
      ? `/explorer?host=${hostId}&database=${database}&table=${table}`
      : null

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Database and Table Selector */}
      <div className="bg-card flex flex-col items-stretch justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
        <DatabaseTableSelector />
        {explorerUrl && (
          <Link
            href={explorerUrl}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            View in Explorer →
          </Link>
        )}
      </div>

      {/* Table Content */}
      {database && table ? (
        <Suspense fallback={<TableSkeleton />}>
          <TableClient
            title={`Parts: ${database}.${table}`}
            description={partInfoConfig.description}
            queryConfig={partInfoConfig}
            searchParams={{ database, table }}
          />
        </Suspense>
      ) : (
        <EmptyState
          variant="no-data"
          title="Select a database and table"
          description="Choose a database and table above to view part information."
          className="h-96"
        />
      )}
    </div>
  )
}

function PartInfoPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <PartInfoContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/part-info')({
  component: PartInfoPage,
})
