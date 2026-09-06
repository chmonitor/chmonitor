'use client'

/**
 * Schema & Settings surface of `/advisor`: Explorer database tree on the left,
 * table-care detail on the right. Recommend-only — copyable advice, no apply.
 */

import { MenuIcon, SparklesIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ReactNode } from 'react'
import type { DatabaseTreeProps } from '@/components/explorer/tree'
import type {
  AdvisorTreeGroup,
  AdvisorTreeSort,
  AdvisorTreeVisibility,
} from '@/lib/ai/advisor/schema-tree'
import type { TuningFinding } from '@/lib/ai/advisor/tuning/types'

import { HealthyEmpty } from './healthy-empty'
import { fetchTuning, type TuningApiResponse } from './helpers'
import { SchemaSidebar } from './schema-sidebar'
import { TableRelations } from './table-relations'
import { TreeToolbar } from './tree-toolbar'
import { useCallback, useMemo, useState } from 'react'
import { TuningFindingsPanel } from '@/components/agents/tuning-findings-panel'
import { useExplorerState } from '@/components/explorer/hooks/use-explorer-state'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  applyAdvisorTreeControls,
  buildTableDetail,
  careKeySet,
  careKeysFromFindings,
  DEFAULT_ADVISOR_TREE_CONTROLS,
  orderDatabases,
  tableAnalysisPrompt,
} from '@/lib/ai/advisor/schema-tree'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

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
