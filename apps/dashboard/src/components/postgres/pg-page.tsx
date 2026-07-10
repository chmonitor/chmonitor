/**
 * Page shell for a Postgres `PgQueryConfig` (issue #2450). The Postgres analog
 * of `QueryPageLayout`: it resolves the active Postgres source (`?pg=`), fetches
 * the config's rows via `usePgQuery`, and renders the appropriate state —
 * skeleton, graceful error (keeps prior rows on a background-refresh failure,
 * matching the ClickHouse stale-indicator pattern), the extension-missing
 * EmptyState, an empty-data state, or the `PgTable`.
 *
 * Never surfaces a raw Postgres error: extension-missing is a first-class
 * empty state, and genuine failures render a friendly, classified message.
 */

import { AlertTriangleIcon, DatabaseIcon, RefreshCwIcon } from 'lucide-react'

import type { PgQueryConfig } from '@/types/pg-query-config'

import { PgExtensionEmptyState } from './pg-extension-empty-state'
import { PgTable } from './pg-table'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useActivePgConnection } from '@/lib/hooks/use-active-pg-connection'
import { usePgQuery } from '@/lib/hooks/use-pg-query'

export interface PgPageProps {
  config: PgQueryConfig
  /** Auto-refresh interval in ms (e.g. running queries). */
  refetchInterval?: number
  onRowClick?: (row: Record<string, unknown>) => void
}

export function PgPage({ config, refetchInterval, onRowClick }: PgPageProps) {
  const pgConn = useActivePgConnection()
  const { data, error, isLoading, isFetching, refetch } = usePgQuery(
    config.name,
    pgConn,
    { refetchInterval }
  )

  const rows = data?.data ?? []
  const hasData = rows.length > 0

  return (
    <div className="flex min-w-0 w-full max-w-full flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {config.title}
          </h1>
          {config.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {config.description}
            </p>
          ) : null}
          {pgConn ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <DatabaseIcon className="size-3.5" strokeWidth={1.5} />
              {pgConn.name} · {pgConn.host}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {error && hasData ? (
            <span
              className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
              title={error instanceof Error ? error.message : String(error)}
            >
              <AlertTriangleIcon className="size-3.5" strokeWidth={1.5} />
              Refresh failed
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={!pgConn || isFetching}
          >
            <RefreshCwIcon className="mr-1.5 size-3.5" strokeWidth={1.5} />
            Refresh
          </Button>
        </div>
      </div>

      <PgPageBody
        config={config}
        pgConnActive={Boolean(pgConn)}
        isLoading={isLoading}
        error={error}
        hasData={hasData}
        rows={rows}
        extensionMissing={Boolean(data?.extensionMissing)}
        onRowClick={onRowClick}
        onRetry={() => refetch()}
      />
    </div>
  )
}

function PgPageBody({
  config,
  pgConnActive,
  isLoading,
  error,
  hasData,
  rows,
  extensionMissing,
  onRowClick,
  onRetry,
}: {
  config: PgQueryConfig
  pgConnActive: boolean
  isLoading: boolean
  error: unknown
  hasData: boolean
  rows: Record<string, unknown>[]
  extensionMissing: boolean
  onRowClick?: (row: Record<string, unknown>) => void
  onRetry: () => void
}) {
  if (!pgConnActive) {
    return (
      <EmptyState
        variant="no-data"
        icon={
          <DatabaseIcon
            className="h-10 w-10 text-muted-foreground/60"
            strokeWidth={1.5}
          />
        }
        title="No Postgres source selected"
        description="Choose a Postgres connection from the host switcher to view its query insights."
      />
    )
  }

  if (extensionMissing && config.extensionCheck) {
    return <PgExtensionEmptyState extension={config.extensionCheck} />
  }

  if (isLoading && !hasData) {
    return <TableSkeleton />
  }

  if (error && !hasData) {
    return (
      <EmptyState
        variant="error"
        title="Couldn't load Postgres data"
        description={error instanceof Error ? error.message : String(error)}
        action={{ label: 'Retry', onClick: onRetry }}
      />
    )
  }

  if (!hasData) {
    return (
      <EmptyState
        variant="no-data"
        title="No rows"
        description="This view returned no rows for the current Postgres source."
        onRefresh={onRetry}
      />
    )
  }

  return <PgTable config={config} rows={rows} onRowClick={onRowClick} />
}
