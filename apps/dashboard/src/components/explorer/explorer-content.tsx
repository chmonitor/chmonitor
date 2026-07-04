import { ExternalLink, SquareTerminal } from 'lucide-react'

import { DatabaseOverview } from './database-overview'
import { ExplorerBreadcrumb } from './explorer-breadcrumb'
import { ExplorerEmptyState } from './explorer-empty-state'
import { type ExplorerTab, useExplorerState } from './hooks/use-explorer-state'
import { DataTab } from './tabs/data-tab'
import { DdlTab } from './tabs/ddl-tab'
import { DependenciesTab } from './tabs/dependencies-tab'
import { IndexesTab } from './tabs/indexes-tab'
import { OverviewTab } from './tabs/overview-tab'
import { QueryTab } from './tabs/query-tab'
import { StructureTab } from './tabs/structure-tab'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface ExplorerContentProps {
  hostName?: string
}

// Track which tabs have been visited for this table to enable pre-loading
function useTabVisitTracker(tableKey: string | null, currentTab: ExplorerTab) {
  const [visitedTabs, setVisitedTabs] = useState<Set<ExplorerTab>>(
    () => new Set<ExplorerTab>(['overview', currentTab])
  )
  const prevTableKey = useRef<string | null>(null)

  // Reset visited tabs when table changes, keeping the active tab
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentTab is only used to seed the set on table reset
  useEffect(() => {
    if (tableKey !== prevTableKey.current) {
      setVisitedTabs(new Set<ExplorerTab>(['overview', currentTab]))
      prevTableKey.current = tableKey
    }
  }, [tableKey])

  // Track visited tabs when currentTab changes externally (e.g. URL/history navigation)
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(currentTab)) return prev
      const next = new Set(prev)
      next.add(currentTab)
      return next
    })
  }, [currentTab])

  const markVisited = useCallback((tab: ExplorerTab) => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [])

  return { visitedTabs, markVisited }
}

export function ExplorerContent({ hostName }: ExplorerContentProps) {
  const hostId = useHostId()
  const { database, table, tab, setTab } = useExplorerState()
  const tableKey = database && table ? `${database}.${table}` : null
  const { visitedTabs, markVisited } = useTabVisitTracker(tableKey, tab)

  const handleTabChange = useCallback(
    (value: string) => {
      if (value === tab) return
      markVisited(value as ExplorerTab)
      setTab(value as ExplorerTab)
    },
    [tab, markVisited, setTab]
  )

  // No database selected and not on query tab — show empty state
  if (!database && tab !== 'query') {
    return <ExplorerEmptyState />
  }

  // Database selected but no table, and not on query tab — show database overview
  if (database && !table && tab !== 'query') {
    return <DatabaseOverview database={database} />
  }

  // Query tab without a table context — render standalone (no tab strip)
  if (tab === 'query' && !table) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <ExplorerBreadcrumb hostName={hostName} />
        <QueryTab />
      </div>
    )
  }

  const partInfoUrl = `/part-info?host=${hostId}&database=${encodeURIComponent(database!)}&table=${encodeURIComponent(table!)}`

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <ExplorerBreadcrumb hostName={hostName} />

      <Tabs id="explorer-tabs" value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="ddl">DDL</TabsTrigger>
          <TabsTrigger value="indexes">Indexes</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="query" className="gap-2">
            <SquareTerminal className="size-3.5" />
            Query
          </TabsTrigger>
          <Link
            href={partInfoUrl}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            Parts
            <ExternalLink className="size-3" />
          </Link>
        </TabsList>

        {/* Overview tab: force-mounted to keep summary cached */}
        <TabsContent
          value="overview"
          className={cn('mt-4', tab !== 'overview' && 'hidden flex-none')}
          forceMount
        >
          {visitedTabs.has('overview') && <OverviewTab />}
        </TabsContent>

        {/* Data tab: render only once visited so the first paint on the
            default Overview tab doesn't fire a hidden `SELECT * ... LIMIT`
            preview against the user's table. Once opened it stays force-mounted,
            preserving pagination state when switching tabs. */}
        <TabsContent
          value="data"
          className={cn('mt-4', tab !== 'data' && 'hidden flex-none')}
          forceMount
        >
          {visitedTabs.has('data') && <DataTab />}
        </TabsContent>

        {/* Structure tab: don't force-mount due to complex filter state */}
        <TabsContent value="structure" className="mt-4 flex-none">
          <StructureTab />
        </TabsContent>

        {/* DDL tab: force-mount to keep content cached */}
        <TabsContent
          value="ddl"
          className={cn('mt-4', tab !== 'ddl' && 'hidden flex-none')}
          forceMount
        >
          {visitedTabs.has('ddl') && <DdlTab />}
        </TabsContent>

        {/* Indexes tab: force-mount to keep content cached */}
        <TabsContent
          value="indexes"
          className={cn('mt-4', tab !== 'indexes' && 'hidden flex-none')}
          forceMount
        >
          {visitedTabs.has('indexes') && <IndexesTab />}
        </TabsContent>

        {/* Dependencies tab: force-mount to keep content cached */}
        <TabsContent
          value="dependencies"
          className={cn('mt-4', tab !== 'dependencies' && 'hidden flex-none')}
          forceMount
        >
          {visitedTabs.has('dependencies') && <DependenciesTab />}
        </TabsContent>

        {/* Query tab: mount only when active. The CodeMirror editor enters an
            infinite measure loop (ResizeObserver on a 0×0 box) if force-mounted
            and hidden via display:none, freezing the page on tab switch. The
            committed query lives in the URL (?q=), so unmounting is lossless for
            meaningful state. Mirrors the Structure tab. */}
        <TabsContent value="query" className="mt-4 flex-none">
          <QueryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
