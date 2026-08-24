'use client'

/**
 * Schema & Settings surface of `/advisor`: Explorer database tree on the left,
 * table-care detail on the right. Recommend-only — copyable advice, no apply.
 */

import {
  ArrowDownAZIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpZAIcon,
  DatabaseIcon,
  EyeOffIcon,
  GitForkIcon,
  LayersIcon,
  ListIcon,
  MenuIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ReactNode } from 'react'
import type { TuningFindingsOutput } from '@/components/agents/tuning-findings-panel'
import type {
  DependencyEdge,
  DependencyType,
} from '@/components/explorer/dependency-graph/dependency-graph'
import type {
  AdvisorTreeGroup,
  AdvisorTreeSort,
  AdvisorTreeVisibility,
} from '@/lib/ai/advisor/schema-tree'
import type { TuningFinding } from '@/lib/ai/advisor/tuning/types'

import { useCallback, useMemo, useState } from 'react'
import { TuningFindingsPanel } from '@/components/agents/tuning-findings-panel'
import { useExplorerState } from '@/components/explorer/hooks/use-explorer-state'
import {
  DatabaseTree,
  type DatabaseTreeProps,
} from '@/components/explorer/tree'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  applyAdvisorTreeControls,
  buildTableDetail,
  careKeySet,
  careKeysFromFindings,
  DEFAULT_ADVISOR_TREE_CONTROLS,
  NEW_TABLE_TIPS,
  orderDatabases,
  tableAnalysisPrompt,
} from '@/lib/ai/advisor/schema-tree'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface TuningApiResponse extends TuningFindingsOutput {
  success: true
}
interface TuningApiError {
  success: false
  error: string
}

interface ApiResponse<T> {
  data: T
}

const fetchTuning = async (url: string): Promise<TuningApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as TuningApiResponse | TuningApiError
  if (!res.ok || !body.success) {
    throw new Error(
      (body as TuningApiError).error || `Scan failed (HTTP ${res.status})`
    )
  }
  return body
}

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json() as Promise<T>
}

function dependencyTypeLabel(type?: DependencyType): string {
  switch (type) {
    case 'dependency':
      return 'MV/View'
    case 'dictGet':
      return 'dictGet()'
    case 'joinGet':
      return 'joinGet()'
    case 'mv_target':
      return 'MV writes TO'
    case 'dict_source':
      return 'Dict source'
    case 'external':
      return 'External'
    default:
      return 'Related'
  }
}

function IconToolButton({
  label,
  pressed,
  testId,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  testId: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={pressed ? 'secondary' : 'ghost'}
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            data-testid={testId}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function TreeToolbar({
  sort,
  group,
  visibility,
  onSort,
  onGroup,
  onVisibility,
}: {
  sort: AdvisorTreeSort
  group: AdvisorTreeGroup
  visibility: AdvisorTreeVisibility
  onSort: (value: AdvisorTreeSort) => void
  onGroup: (value: AdvisorTreeGroup) => void
  onVisibility: (value: AdvisorTreeVisibility) => void
}) {
  const SortIcon =
    sort === 'name-desc'
      ? ArrowUpZAIcon
      : sort === 'care-first'
        ? ArrowDownWideNarrowIcon
        : ArrowDownAZIcon

  return (
    <TooltipProvider>
      <div
        className="flex items-center justify-between gap-1"
        data-testid="advisor-schema-tree-toolbar"
      >
        <div className="inline-flex rounded-md border border-border/60 p-0.5">
          <IconToolButton
            label="All tables"
            pressed={visibility === 'all'}
            testId="advisor-tree-filter-all"
            onClick={() => onVisibility('all')}
          >
            <ListIcon className="size-3.5" strokeWidth={1.5} />
          </IconToolButton>
          <IconToolButton
            label="Needs attention"
            pressed={visibility === 'care'}
            testId="advisor-tree-filter-care"
            onClick={() => onVisibility('care')}
          >
            <TriangleAlertIcon className="size-3.5" strokeWidth={1.5} />
          </IconToolButton>
          <IconToolButton
            label="Hide suggested tables"
            pressed={visibility === 'hide-care'}
            testId="advisor-tree-filter-hide"
            onClick={() => onVisibility('hide-care')}
          >
            <EyeOffIcon className="size-3.5" strokeWidth={1.5} />
          </IconToolButton>
        </div>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Group tables"
                  data-testid="advisor-tree-group"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                />
              }
            >
              {group === 'engine' ? (
                <LayersIcon className="size-3.5" strokeWidth={1.5} />
              ) : (
                <DatabaseIcon className="size-3.5" strokeWidth={1.5} />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                onClick={() => onGroup('database')}
                data-testid="advisor-tree-group-database"
              >
                Database
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onGroup('care')}
                data-testid="advisor-tree-group-care"
              >
                Needs attention first
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onGroup('engine')}
                data-testid="advisor-tree-group-engine"
              >
                Engine
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Sort tables"
                  data-testid="advisor-tree-sort"
                  className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                />
              }
            >
              <SortIcon className="size-3.5" strokeWidth={1.5} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                onClick={() => onSort('name-asc')}
                data-testid="advisor-tree-sort-az"
              >
                <ArrowDownAZIcon className="size-3.5" strokeWidth={1.5} />A to Z
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSort('name-desc')}
                data-testid="advisor-tree-sort-za"
              >
                <ArrowUpZAIcon className="size-3.5" strokeWidth={1.5} />Z to A
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onSort('care-first')}
                data-testid="advisor-tree-sort-care"
              >
                <ArrowDownWideNarrowIcon
                  className="size-3.5"
                  strokeWidth={1.5}
                />
                Needs attention first
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}

function NewTableTips() {
  return (
    <div className="space-y-3" data-testid="advisor-new-table-tips">
      <h3 className="text-sm font-medium text-foreground">
        Tips for creating new tables
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {NEW_TABLE_TIPS.map((tip) => (
          <li
            key={tip.title}
            className="rounded-xl border bg-card p-3 shadow-sm"
          >
            <p className="text-[13px] font-medium text-foreground">
              {tip.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{tip.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HealthyEmpty({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="advisor-schema-healthy">
      <div className="rounded-xl border border-dashed bg-card/40 px-6 py-8">
        <EmptyState variant="no-data" title={title} description={description} />
      </div>
      <NewTableTips />
    </div>
  )
}

function TableRelations({
  database,
  table,
}: {
  database: string
  table: string
}) {
  const hostId = useHostId()
  const apiUrl = `/api/v1/explorer/dependencies?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}&direction=table`
  const { data, error, isLoading } = useQuery<ApiResponse<DependencyEdge[]>>({
    queryKey: [apiUrl],
    queryFn: () => fetchJson<ApiResponse<DependencyEdge[]>>(apiUrl),
  })
  const edges = (data?.data ?? []).filter(
    (edge) => edge.target_table && edge.dependency_type
  )

  return (
    <section className="space-y-2" data-testid="advisor-table-relations">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GitForkIcon
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <h2 className="text-sm font-medium text-foreground">Relations</h2>
        </div>
        <Link
          href={buildUrl('/explorer', {
            host: hostId,
            database,
            table,
            tab: 'dependencies',
          })}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open in Explorer
        </Link>
      </div>
      {isLoading ? <TableSkeleton rows={2} /> : null}
      {error ? (
        <p className="text-xs text-muted-foreground">
          Could not load relations.
        </p>
      ) : null}
      {!isLoading && !error && edges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No materialized views or related objects found for this table.
        </p>
      ) : null}
      {edges.length > 0 ? (
        <ul className="space-y-1.5">
          {edges.map((edge) => {
            const targetDb = edge.target_database || database
            const targetTable = edge.target_table as string
            return (
              <li
                key={`${edge.source_database}.${edge.source_table}->${targetDb}.${targetTable}:${edge.dependency_type}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {edge.source_database}.{edge.source_table}
                  </span>
                  <span className="px-1.5 text-muted-foreground">→</span>
                  <span className="font-medium">
                    {targetDb}.{targetTable}
                  </span>
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {dependencyTypeLabel(edge.dependency_type)}
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function SchemaSidebar({
  treeProps,
  isOpen,
  onOpenChange,
}: {
  treeProps: DatabaseTreeProps
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const tree = (
    <div
      className="overflow-y-auto px-2 pb-4"
      data-testid="advisor-schema-tree"
    >
      <DatabaseTree {...treeProps} />
    </div>
  )

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Database browser</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">{tree}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r md:w-72 lg:w-80">
      {tree}
    </div>
  )
}

export function AdvisorSchemaTab() {
  const hostId = useHostId()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sort, setSort] = useState<AdvisorTreeSort>(
    DEFAULT_ADVISOR_TREE_CONTROLS.sort
  )
  const [group, setGroup] = useState<AdvisorTreeGroup>(
    DEFAULT_ADVISOR_TREE_CONTROLS.group
  )
  const [visibility, setVisibility] = useState<AdvisorTreeVisibility>(
    DEFAULT_ADVISOR_TREE_CONTROLS.visibility
  )
  const { database, table, engine } = useExplorerState()

  const tuningUrl = database
    ? `/api/v1/advisor/tuning?hostId=${hostId}&database=${encodeURIComponent(database)}`
    : null

  const { data, error, isLoading, isFetching } = useQuery<TuningApiResponse>({
    queryKey: [tuningUrl],
    queryFn: () => fetchTuning(tuningUrl as string),
    enabled: Boolean(tuningUrl),
    staleTime: 5 * 60_000,
  })

  const findings: TuningFinding[] = data?.findings ?? []
  const careKeys = useMemo(
    () => careKeySet(careKeysFromFindings(findings)),
    [findings]
  )
  const detail =
    database && table
      ? buildTableDetail({
          database,
          table,
          engine: engine ?? undefined,
          findings,
        })
      : null
  const settingsFindings = findings.filter((row) => row.category === 'settings')
  const analyzing = Boolean(tuningUrl) && (isLoading || (isFetching && !data))
  const agentHref = buildUrl('/agents', { host: hostId })
  const prompt = database && table ? tableAnalysisPrompt(database, table) : null

  const transformTables = useCallback(
    (
      tables: Parameters<NonNullable<DatabaseTreeProps['transformTables']>>[0],
      query: string
    ) =>
      applyAdvisorTreeControls(
        tables,
        { query, sort, group, visibility },
        careKeys
      ),
    [sort, group, visibility, careKeys]
  )

  const sortDatabases = useCallback(
    <T extends { name: string }>(rows: T[]) =>
      orderDatabases(rows, group, careKeys),
    [group, careKeys]
  )

  const treeProps: DatabaseTreeProps = {
    careKeys,
    transformTables,
    sortDatabases,
    toolbar: (
      <TreeToolbar
        sort={sort}
        group={group}
        visibility={visibility}
        onSort={setSort}
        onGroup={setGroup}
        onVisibility={setVisibility}
      />
    ),
  }

  let main: ReactNode
  if (!database) {
    main = (
      <HealthyEmpty
        title="Pick a database or table"
        description="The tree on the left is the same explorer as Data Explorer. Tables that need attention get an amber dot after a scan. Recommend-only — nothing is applied for you."
      />
    )
  } else if (analyzing) {
    main = <TableSkeleton rows={5} />
  } else if (error) {
    main = (
      <ErrorAlert
        title="Scan failed"
        message={error instanceof Error ? error.message : String(error)}
      />
    )
  } else if (detail) {
    main = (
      <div className="flex flex-col gap-4" data-testid="advisor-table-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {detail.database}.{detail.table}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {detail.engine || 'table'}
              {detail.needsCare
                ? ` · ${detail.suggestions.length} suggestion${detail.suggestions.length === 1 ? '' : 's'}`
                : ' · looking healthy'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href={agentHref} />}
              data-testid="advisor-ask-agent"
            >
              <SparklesIcon className="size-3.5" strokeWidth={1.5} />
              Ask the AI agent
            </Button>
          </div>
        </div>
        {prompt ? (
          <p className="text-xs text-muted-foreground">{prompt}</p>
        ) : null}

        {detail.needsCare ? (
          <TuningFindingsPanel
            output={{
              database: detail.database,
              table: detail.table,
              findings: detail.findings,
              notes: data?.notes ?? [],
            }}
          />
        ) : (
          <HealthyEmpty
            title="This table looks well-tuned"
            description="No schema lint or table-level findings for this table. Copyable advice only — this page never runs ALTER or CREATE."
          />
        )}

        {settingsFindings.length > 0 ? (
          <TuningFindingsPanel
            output={{
              database: detail.database,
              findings: settingsFindings,
              notes: ['Server and MergeTree settings for this host.'],
            }}
          />
        ) : null}

        <TableRelations database={detail.database} table={detail.table} />
      </div>
    )
  } else if (data && findings.length === 0 && settingsFindings.length === 0) {
    main = (
      <HealthyEmpty
        title="Nothing to fix in this database"
        description={`${database} looks well-tuned — no schema lint or settings findings. Here are tips if you are creating a new table.`}
      />
    )
  } else if (data) {
    main = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {careKeys.size} table{careKeys.size === 1 ? '' : 's'} in {database}{' '}
          need attention. Select one in the tree for detail, relations, and
          copyable suggestions.
        </p>
        <TuningFindingsPanel output={data} />
      </div>
    )
  } else {
    main = (
      <HealthyEmpty
        title="Pick a table"
        description="Select a table to see findings, relations, and recommend-only DDL."
      />
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-[32rem]',
        isMobile ? 'h-auto flex-col gap-3' : 'h-[calc(100dvh-10rem)]'
      )}
      data-testid="advisor-schema-tab"
    >
      {isMobile ? (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open database browser"
          >
            <MenuIcon className="size-4" />
          </Button>
          <p className="text-sm text-muted-foreground">
            Database and table tree
          </p>
        </div>
      ) : null}
      <SchemaSidebar
        treeProps={treeProps}
        isOpen={sidebarOpen}
        onOpenChange={setSidebarOpen}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">{main}</div>
    </div>
  )
}
