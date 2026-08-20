import { CheckCircle2Icon, PanelLeftCloseIcon } from 'lucide-react'

import type { EmptyStateVariant } from '@/components/ui/empty-state'
import type { TableDiff } from '@/lib/schema-diff'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

interface TableListProps {
  rows: TableDiff[]
  selectedKey: string | null
  onSelect: (key: string) => void
  example?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyVariant?: EmptyStateVariant
  emptyCompact?: boolean
  onCollapse?: () => void
}

function kindLabel(kind: TableDiff['kind']): string {
  if (kind === 'only_source') return 'source only'
  if (kind === 'only_target') return 'target only'
  if (kind === 'changed') return 'changed'
  return 'same'
}

export function TableList({
  rows,
  selectedKey,
  onSelect,
  example = false,
  emptyTitle = 'No tables match',
  emptyDescription = 'Try a different filter or switch to All.',
  emptyVariant = 'filtered-empty',
  emptyCompact = true,
  onCollapse,
}: TableListProps) {
  return (
    <Card
      className="gap-0 rounded-xl border bg-card py-0 shadow-sm"
      data-testid="schema-diff-table-list"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">
          Tables
          {rows.length > 0 ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {rows.length}
            </span>
          ) : null}
        </h2>
        {onCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCollapse}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Hide table list"
            data-testid="schema-diff-sidebar-collapse"
          >
            <PanelLeftCloseIcon className="size-3.5" strokeWidth={1.5} />
          </Button>
        ) : null}
      </div>
      <CardContent className="p-0">
        <ul className="max-h-[min(36rem,70vh)] divide-y divide-border overflow-y-auto">
          {rows.length === 0 ? (
            <li className="p-4">
              <EmptyState
                variant={emptyVariant}
                compact={emptyCompact}
                title={emptyTitle}
                description={emptyDescription}
              />
            </li>
          ) : (
            rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted',
                    selectedKey === row.key && 'bg-muted'
                  )}
                  aria-current={selectedKey === row.key ? 'true' : undefined}
                  onClick={() => onSelect(row.key)}
                >
                  <span className="truncate font-mono">{row.key}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {example ? (
                      <Badge
                        variant="secondary"
                        className="font-normal text-[10px]"
                      >
                        Example
                      </Badge>
                    ) : null}
                    {row.kind === 'identical' ? (
                      <CheckCircle2Icon
                        className="size-3.5 text-[var(--chart-green)]"
                        strokeWidth={1.5}
                        aria-label="matched"
                        data-testid="schema-diff-matched-icon"
                      />
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        {kindLabel(row.kind)}
                      </Badge>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
