import { Info, RefreshCw } from 'lucide-react'

import type { ApiResponseMetadata } from '@/lib/api/types'
import type { QueryConfig } from '@/types/query-config'

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CardToolbar } from '@/components/cards/card-toolbar'
import { DataTable } from '@/components/data-table/data-table'
import { FilterBar } from '@/components/filters/filter-bar'
import { TableSkeleton } from '@/components/skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { SuggestionCard } from '@/components/ui/suggestion-card'
import {
  type CardError,
  detectCardErrorVariant,
  extractTableFromPermissionError,
  getCardErrorClassName,
  getCardErrorDescription,
  getCardErrorTitle,
  getTableMissingInfo,
  isVersionOlder,
  shouldShowRetryButton,
} from '@/lib/card-error-utils'
import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr/use-host'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'
import { getSqlForDisplay } from '@/types/query-config'

interface TableClientProps {
  title: string
  description?: string | React.ReactNode
  queryConfig: QueryConfig
  searchParams?: Record<string, string | number | boolean>
  className?: string
  defaultPageSize?: number
  topRightToolbarExtras?: React.ReactNode
  /** Enable client-side column text filtering */
  enableColumnFilters?: boolean
  /** Columns to enable filtering for (default: all text columns) */
  filterableColumns?: string[]
  /** Enable row selection with checkboxes */
  enableRowSelection?: boolean
  /**
   * Render the schema-driven filter bar above the table when the
   * QueryConfig declares a filterSchema (default: true). Set to false
   * when the surrounding page already renders its own FilterBar to avoid
   * a duplicated control wired to the same URL state.
   */
  showFilterBar?: boolean
  /**
   * When set, clicking a row (outside interactive elements) calls this with
   * the row's data instead of the default behavior — e.g. to open a detail
   * Sheet. Desktop table rows only; the mobile card view does not yet
   * support this.
   */
  onRowClick?: (row: Record<string, unknown>) => void
}

const tableRowFormatter = new Intl.NumberFormat('en-US')

function GuidanceMarkdown({ content }: { content: string }) {
  return (
    <div className="text-foreground/80 leading-relaxed [&>p]:my-0 [&>p+p]:mt-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          code: ({ className, children, ...props }) => {
            const isInline = !className?.startsWith('language-')
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={cn('font-mono', className)} {...props}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded border bg-muted p-2 text-[0.85em] leading-snug">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function TableResultFootnote({ metadata }: { metadata: ApiResponseMetadata }) {
  const beforeCap =
    typeof metadata.resultRowsBeforeCap === 'number'
      ? tableRowFormatter.format(metadata.resultRowsBeforeCap)
      : null
  const duration =
    typeof metadata.duration === 'number'
      ? metadata.duration.toFixed(2)
      : '0.00'

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>
        {tableRowFormatter.format(metadata.rows)} row(s) in {duration}s
      </span>
      {metadata.resultRowsTruncated ? (
        <>
          <Badge variant="outline">Capped</Badge>
          {beforeCap ? <span>{beforeCap} before cap</span> : null}
        </>
      ) : null}
    </span>
  )
}

/**
 * Client-side table wrapper that handles data fetching with SWR
 * Provides loading, error, and empty states with automatic refresh capability
 *
 * @example
 * ```tsx
 * export default function QueryLogsPage() {
 *   return (
 *     <TableClient
 *       title="Query Logs"
 *       description="All queries executed on the cluster"
 *       queryConfig={queryLogsConfig}
 *     />
 *   )
 * }
 * ```
 */
export const TableClient = function TableClient({
  title,
  description,
  queryConfig,
  searchParams = {},
  className,
  defaultPageSize = 100,
  topRightToolbarExtras,
  enableColumnFilters = false,
  filterableColumns,
  enableRowSelection = false,
  showFilterBar = true,
  onRowClick,
}: TableClientProps) {
  const hostId = useHostId()
  const hostStatus = useHostStatus(hostId)
  const refreshInterval = queryConfig.refreshInterval ?? 0

  // Memoize context to prevent columnDefs recalculation on every render.
  // Without this, every SWR revalidation cycle triggers full table re-renders
  // because new context object → new contextWithPrefix → new columnDefs → all cells re-render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: JSON.stringify gives value-stable deps when callers pass an inline literal
  const context = useMemo(
    () => ({ ...searchParams, hostId: String(hostId) }),
    [JSON.stringify(searchParams), hostId]
  )

  const { data, metadata, error, isPending, isValidating, refresh } =
    useTableData<Record<string, unknown>>(
      queryConfig.name,
      hostId,
      searchParams,
      refreshInterval
    )

  // Keep the skeleton up until the query has actually settled. `isPending` is
  // true whenever no successful response has loaded yet — including the brief
  // dispatched-but-not-yet-fetching / paused / first-paint window where
  // `isFetching` (and thus `isValidating`) is false. Without it the empty-state
  // below would flash before the first result arrives. Also keep the skeleton
  // while re-validating from an empty cache.
  const isInitialLoading =
    isPending || (isValidating && (!data || data.length === 0))

  if (isInitialLoading) {
    return <TableSkeleton />
  }

  // Get SQL for display in toolbars
  const sql = queryConfig.sql ? getSqlForDisplay(queryConfig.sql) : undefined

  // Whether the schema-driven filter bar should render. When true, the empty
  // state keeps the filter bar mounted (see the zero-rows branch) so filters
  // stay reachable instead of disappearing with the table.
  const showSchemaFilterBar = Boolean(showFilterBar && queryConfig.filterSchema)

  if (error) {
    const serverVersion = hostStatus.data?.version
    const versionedSql = Array.isArray(queryConfig.sql) ? queryConfig.sql : []
    const minSince = versionedSql.length > 0 ? versionedSql[0].since : undefined
    const isVersionMismatch =
      serverVersion && minSince
        ? isVersionOlder(serverVersion, minSince)
        : false

    // 1. Version Mismatch Check (Pre-emptive)
    if (isVersionMismatch) {
      return (
        <Card
          className={cn(
            'rounded-md shadow-none py-2 group relative border-warning/30 bg-warning/5',
            className
          )}
        >
          <CardContent className="p-4">
            <Alert className="border-0 pr-12">
              <Info className="h-4 w-4 text-warning" />
              <AlertTitle>Version Mismatch</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <p>
                  This feature requires ClickHouse version{' '}
                  <strong>{minSince}</strong> or newer. The current ClickHouse
                  host runs version <strong>{serverVersion}</strong>.
                </p>
                <div className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
                  <p>
                    Please upgrade your ClickHouse instance or choose another
                    host that meets the minimum requirement.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )
    }

    const variant = detectCardErrorVariant(error as CardError)
    const showRetry = shouldShowRetryButton(error as CardError)

    // 2. Permission / GRANT Suggestion Check
    if (variant === 'permission') {
      const errorTitle = getCardErrorTitle(variant, title)
      // Use standardized copy — never pass through raw ClickHouse error text
      const errorDescription =
        'The current ClickHouse user does not have sufficient privileges to query this table. Contact your administrator to grant SELECT permissions.'

      const rawMessage = error.message || ''
      const extracted = extractTableFromPermissionError(rawMessage)
      // Only construct GRANT when we have a single unambiguous table
      const rawCheck = queryConfig.tableCheck
      const hasExtracted = typeof extracted === 'string'
      const hasSingleCheck =
        typeof rawCheck === 'string' ||
        (Array.isArray(rawCheck) && rawCheck.length === 1)
      const targetTable = hasExtracted
        ? extracted
        : hasSingleCheck
          ? Array.isArray(rawCheck)
            ? rawCheck[0]
            : rawCheck
          : undefined

      const grantQuery = targetTable
        ? `GRANT SELECT ON ${targetTable} TO <your_clickhouse_user>;`
        : undefined

      return (
        <Card
          className={cn(
            'rounded-md shadow-none py-2 group relative border-destructive/30 bg-destructive/5',
            className
          )}
        >
          <div className="absolute top-3 right-3">
            <CardToolbar sql={sql} metadata={metadata} alwaysVisible />
          </div>
          <CardContent className="p-6">
            <div className="flex flex-col gap-4">
              <EmptyState
                variant="error"
                title={errorTitle}
                description={errorDescription}
                compact={true}
              />
              {grantQuery ? (
                <div className="mt-2 text-sm border-t pt-4">
                  <p className="mb-2 font-medium">
                    To grant the required permissions, execute the following SQL
                    query as admin:
                  </p>
                  <SuggestionCard suggestion={grantQuery} />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground border-t pt-4">
                  Unable to determine the required table — check ClickHouse user
                  permissions.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )
    }

    // 3. Table Missing Check
    if (variant === 'table-missing') {
      const errorTitle = getCardErrorTitle(variant, title)
      const errorDescription = getCardErrorDescription(
        error as CardError,
        variant
      )
      const tableMissingInfo = getTableMissingInfo(error as CardError)
      const guidance = tableMissingInfo?.guidance

      return (
        <Card
          className={cn(
            'rounded-md shadow-none py-2 group relative',
            className
          )}
        >
          <div className="absolute top-3 right-3">
            <CardToolbar sql={sql} metadata={metadata} alwaysVisible />
          </div>
          <CardContent className="p-4">
            <Alert
              aria-label={
                title ? `${title} unavailable` : 'Table not available'
              }
              className="border-0 pr-12"
            >
              <Info />
              <AlertTitle>{errorTitle}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <p>{errorDescription}</p>
                {guidance ? (
                  <div className="flex flex-col gap-1 border-t pt-3 text-xs">
                    <GuidanceMarkdown content={guidance.enableInstructions} />
                    {guidance.docsUrl && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto justify-start p-0 text-xs"
                        render={
                          <a
                            href={guidance.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View ClickHouse documentation ↗
                          </a>
                        }
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 border-t pt-3 text-xs">
                    <p>
                      This feature requires additional ClickHouse configuration.
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto justify-start p-0 text-xs"
                      render={
                        <a
                          href="https://clickhouse.com/docs/en/operations/system-tables"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View ClickHouse documentation ↗
                        </a>
                      }
                    />
                  </div>
                )}
                {showRetry && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => refresh()}
                  >
                    <RefreshCw data-icon="inline-start" />
                    Retry
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )
    }

    // Fall back to generic error handling for other error types
    const errorTitle = getCardErrorTitle(variant, title)
    const errorClassName = getCardErrorClassName(variant)
    const errorDescription = getCardErrorDescription(
      error as CardError,
      variant
    )

    return (
      <Card
        className={cn(
          'rounded-md shadow-none py-2 group relative',
          errorClassName,
          className
        )}
        role="alert"
        aria-label={title ? `${title} error` : 'Error loading table'}
      >
        <div className="absolute top-3 right-3">
          <CardToolbar sql={sql} metadata={metadata} alwaysVisible />
        </div>
        <CardContent className="p-4">
          <EmptyState
            variant={variant}
            title={errorTitle}
            description={errorDescription}
            compact={true}
            action={
              showRetry
                ? {
                    label: 'Retry',
                    onClick: refresh,
                    icon: <RefreshCw className="mr-1.5 size-3.5" />,
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>
    )
  }

  if (!data || (Array.isArray(data) && data.length === 0)) {
    const emptyCard = (
      <Card
        className={cn(
          'rounded-md border-warning/30 bg-warning/5 shadow-none py-2 group relative',
          className
        )}
      >
        <div className="absolute top-3 right-3">
          <CardToolbar sql={sql} metadata={metadata} alwaysVisible />
        </div>
        <CardContent className="p-6">
          <div className="flex flex-col items-center gap-4">
            <EmptyState
              variant={showSchemaFilterBar ? 'filtered-empty' : 'no-data'}
              title={title || 'No Data'}
              description={
                showSchemaFilterBar
                  ? 'No queries match the current filters. Adjust or clear them above to widen the results.'
                  : 'No data available for this query. Try adjusting your filters or check back later.'
              }
            />
            {queryConfig.suggestion && (
              <SuggestionCard
                suggestion={queryConfig.suggestion}
                className="mt-4"
              />
            )}
          </div>
        </CardContent>
      </Card>
    )

    // Keep the schema-driven filter bar mounted even with zero rows, so the
    // user can widen/clear filters without the controls vanishing. Only the
    // results area below shows the empty state. Non-schema tables keep the
    // plain empty card.
    if (!showSchemaFilterBar) return emptyCard

    return (
      <div className={cn('flex min-w-0 flex-col', className)}>
        <div className="flex flex-col gap-2.5 pb-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5">
                {description || queryConfig.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 bg-card/65 dark:bg-card/40 border border-border/60 p-2 rounded-xl shadow-xs">
            <FilterBar queryConfig={queryConfig} />
          </div>
        </div>
        {emptyCard}
      </div>
    )
  }

  return (
    <DataTable
      title={title}
      description={description}
      queryConfig={queryConfig}
      data={data}
      context={context}
      defaultPageSize={defaultPageSize}
      footnote={
        metadata ? <TableResultFootnote metadata={metadata} /> : undefined
      }
      className={className}
      topRightToolbarExtras={topRightToolbarExtras}
      enableColumnFilters={enableColumnFilters}
      filterableColumns={filterableColumns}
      isRefreshing={isValidating}
      enableRowSelection={enableRowSelection}
      metadata={metadata}
      showFilterBar={showFilterBar}
      onRowClick={onRowClick}
    />
  )
}
