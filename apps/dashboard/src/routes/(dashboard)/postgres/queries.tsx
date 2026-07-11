import { createFileRoute } from '@tanstack/react-router'

import { useState } from 'react'
import { PgPage } from '@/components/postgres/pg-page'
import { PgPatternDetailSheet } from '@/components/postgres/pg-pattern-detail-sheet'
import { PostgresInsightsPanel } from '@/components/postgres/postgres-insights-panel'
import { pgSlowPatternsConfig } from '@/lib/pg-query-config'

/**
 * Postgres Query Insights — slow query patterns from `pg_stat_statements`
 * (issue #2450). Holds the selected-pattern state and renders the detail
 * flyout alongside the table, mirroring the ClickHouse Slow Query Patterns page.
 */
function PostgresQueriesPage() {
  const [selectedRow, setSelectedRow] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <PostgresInsightsPanel className="mb-6" />
      <PgPage
        config={pgSlowPatternsConfig}
        refetchInterval={30_000}
        onRowClick={(row) => {
          setSelectedRow(row)
          setSheetOpen(true)
        }}
      />
      <PgPatternDetailSheet
        config={pgSlowPatternsConfig}
        row={selectedRow}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  )
}

export const Route = createFileRoute('/(dashboard)/postgres/queries')({
  component: PostgresQueriesPage,
})
