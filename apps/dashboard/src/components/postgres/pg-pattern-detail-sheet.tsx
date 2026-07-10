/**
 * Detail flyout for a Postgres query pattern (issue #2450). Mirrors the
 * ClickHouse slow-query-patterns `PatternDetailSheet`: clicking a row opens a
 * Sheet scoped to that pattern with the full (normalized) query text and a
 * per-metric breakdown. The clicked row already carries every aggregate the
 * table computed, so no extra query is needed here.
 */

import type { PgQueryConfig } from '@/types/pg-query-config'

import { formatPgValue } from './pg-format'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

export interface PgPatternDetailSheetProps {
  config: PgQueryConfig
  /** Which row key holds the full query text. Defaults to `query`. */
  queryKey?: string
  row: Record<string, unknown> | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PgPatternDetailSheet({
  config,
  queryKey = 'query',
  row,
  open,
  onOpenChange,
}: PgPatternDetailSheetProps) {
  const queryText = row ? String(row[queryKey] ?? '') : ''
  // Every metric column except the query text itself.
  const metricColumns = config.columns.filter((c) => c.key !== queryKey)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl"
      >
        {open && row ? (
          <>
            <SheetHeader className="space-y-3 border-b px-5 py-4">
              <SheetTitle className="text-base">Query pattern</SheetTitle>
              <SheetDescription>
                Aggregate metrics for this normalized statement.
              </SheetDescription>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
                {queryText || '—'}
              </pre>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-5 py-4">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    This pattern
                  </h4>
                  <Separator className="mb-3" />
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {metricColumns.map((col) => (
                      <div key={col.key} className="min-w-0">
                        <dt className="truncate text-xs text-muted-foreground">
                          {col.label}
                        </dt>
                        <dd className="mt-0.5 font-mono text-sm tabular-nums">
                          {formatPgValue(row[col.key], col.format)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
