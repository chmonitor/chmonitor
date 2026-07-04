import { createFileRoute } from '@tanstack/react-router'

import { useState } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PatternDetailSheet } from '@/components/slow-query-patterns/pattern-detail-sheet'
import { slowQueryPatternsConfig } from '@/lib/query-config/queries/slow-query-patterns'

/**
 * Slow Query Patterns page. Custom (not a bare `createPage()`) so it can hold
 * the selected-pattern state and render the detail flyout (#2262) alongside
 * the table — clicking a row opens `PatternDetailSheet` scoped to that row's
 * `normalized_query_hash`.
 */
function SlowQueryPatternsPage() {
  const [selectedPattern, setSelectedPattern] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  return (
    <>
      <PageLayout
        queryConfig={slowQueryPatternsConfig}
        title="Slow Query Patterns"
        onRowClick={(row) => {
          setSelectedPattern(row)
          setSheetOpen(true)
        }}
      />
      <PatternDetailSheet
        pattern={selectedPattern}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  )
}

export const Route = createFileRoute('/(dashboard)/slow-query-patterns')({
  component: SlowQueryPatternsPage,
})
