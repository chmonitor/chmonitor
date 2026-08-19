import type { EmptyStateVariant } from '@/components/ui/empty-state'
import type { TableDiff } from '@/lib/schema-diff'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

interface TableListProps {
  rows: TableDiff[]
  selectedKey: string | null
  onSelect: (key: string) => void
  example?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyVariant?: EmptyStateVariant
  emptyCompact?: boolean
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
}: TableListProps) {
  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
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
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted ${
                    selectedKey === row.key ? 'bg-muted' : ''
                  }`}
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
                    <Badge variant="outline" className="text-muted-foreground">
                      {kindLabel(row.kind)}
                    </Badge>
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
