/**
 * Graceful empty state shown when a required Postgres extension (e.g.
 * `pg_stat_statements`) is not installed on the target database (issue #2450).
 * The Postgres analog of the ClickHouse `table-missing` state: it explains how
 * to enable the extension and never surfaces a raw Postgres error.
 */

import { PuzzleIcon } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'

export interface PgExtensionEmptyStateProps {
  extension: string
}

export function PgExtensionEmptyState({
  extension,
}: PgExtensionEmptyStateProps) {
  return (
    <EmptyState
      variant="table-missing"
      icon={
        <PuzzleIcon
          className="h-10 w-10 text-muted-foreground/60"
          strokeWidth={1.5}
        />
      }
      title={`Extension "${extension}" is not installed`}
      description={
        <span className="flex flex-col items-center gap-3">
          <span className="max-w-md text-center">
            This view reads from the{' '}
            <code className="font-mono">{extension}</code> extension, which
            isn't enabled on this database. Enable it, then refresh.
          </span>
          <span
            data-testid="pg-extension-enable-steps"
            className="w-full max-w-md rounded-lg border bg-muted/40 p-3 text-left font-mono text-xs leading-relaxed text-foreground/90"
          >
            <span className="block text-muted-foreground">
              {
                '-- 1. add to shared_preload_libraries in postgresql.conf, restart:'
              }
            </span>
            <span className="block">
              shared_preload_libraries = '{extension}'
            </span>
            <span className="mt-2 block text-muted-foreground">
              {'-- 2. then, in the target database:'}
            </span>
            <span className="block">CREATE EXTENSION {extension};</span>
          </span>
        </span>
      }
    />
  )
}
