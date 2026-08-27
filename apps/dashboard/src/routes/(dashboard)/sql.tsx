import { MenuIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { useState } from 'react'
import { ExplorerSidebar } from '@/components/explorer/explorer-sidebar'
import { useExplorerState } from '@/components/explorer/hooks/use-explorer-state'
import { RelatedPagesLink } from '@/components/navigation/related-pages-link'
import { SqlConsole } from '@/components/sql-console'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { useHostId } from '@/lib/swr'

/**
 * Standalone SQL Console. Mirrors the Explorer's left database-tree sidebar:
 * clicking a table seeds a query and sets the current database, so the console
 * shares the explorer's URL-driven state (`database`, `table`, `q`).
 */
function SqlConsolePage() {
  const hostId = useHostId()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { database, table, customQuery, setCustomQuery, setDefaultDatabase } =
    useExplorerState()

  const initialSql =
    customQuery ||
    (database && table
      ? `SELECT *\nFROM \`${database}\`.\`${table}\`\nLIMIT 100`
      : 'SELECT * FROM system.tables LIMIT 100')

  const consoleEl = (
    <SqlConsole
      // Reset editor/runner when the table context changes, but not on a bare
      // default-database switch (the picker should preserve the query).
      key={`${hostId}:${table ?? ''}`}
      hostId={hostId}
      initialSql={initialSql}
      variant="page"
      onQueryCommitted={(sql) => setCustomQuery(sql)}
      database={database ?? undefined}
      onDatabaseChange={(db) => setDefaultDatabase(db ?? null)}
    />
  )

  const header = (
    <div className="flex items-center gap-3">
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open database browser"
        >
          <MenuIcon className="size-4" />
        </Button>
      )}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold">SQL Console</h1>
          <RelatedPagesLink href="/sql" className="shrink-0" />
        </div>
        <p className="text-muted-foreground text-sm">
          Run read-only SQL with history, EXPLAIN, query log and scan analysis.
        </p>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <div className="flex h-[calc(100dvh-6rem)] flex-col gap-3 p-4">
        {header}
        <div className="min-h-0 flex-1">{consoleEl}</div>
        <ExplorerSidebar isOpen={sidebarOpen} onOpenChange={setSidebarOpen} />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)]">
      <div className="w-64 shrink-0 overflow-auto lg:w-72">
        <ExplorerSidebar />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {header}
        <div className="min-h-0 flex-1">{consoleEl}</div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/sql')({
  component: SqlConsolePage,
})
