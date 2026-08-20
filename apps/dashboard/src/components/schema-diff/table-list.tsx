import {
  CheckCircle2Icon,
  ChevronRightIcon,
  DatabaseIcon,
  PanelLeftCloseIcon,
  SearchIcon,
} from 'lucide-react'

import type { TableDiff } from '@/lib/schema-diff'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { groupDiffsByDatabase, tableNameOf } from '@/lib/schema-diff/group'
import { cn } from '@/lib/utils'

interface TableListProps {
  rows: TableDiff[]
  selectedKey: string | null
  onSelect: (key: string) => void
  example?: boolean
  nameFilter?: string
  onNameFilterChange?: (value: string) => void
  nameFilterPlaceholder?: string
  onCollapse?: () => void
}

function kindLabel(kind: TableDiff['kind']): string {
  if (kind === 'only_source') return 'source only'
  if (kind === 'only_target') return 'target only'
  if (kind === 'changed') return 'changed'
  return 'same'
}

function KindMark({ row, example }: { row: TableDiff; example: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {example ? (
        <Badge variant="secondary" className="font-normal text-[10px]">
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
        <Badge variant="outline" className="text-muted-foreground">
          {kindLabel(row.kind)}
        </Badge>
      )}
    </span>
  )
}

export function TableList({
  rows,
  selectedKey,
  onSelect,
  example = false,
  nameFilter = '',
  onNameFilterChange,
  nameFilterPlaceholder = 'Filter tables…',
  onCollapse,
}: TableListProps) {
  const groups = useMemo(() => groupDiffsByDatabase(rows), [rows])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const filtering = nameFilter.trim().length > 0

  return (
    <Card
      className="gap-0 rounded-xl border bg-card py-0 shadow-sm"
      data-testid="schema-diff-table-list"
    >
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
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
        {onNameFilterChange ? (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={nameFilter}
              onChange={(e) => onNameFilterChange(e.target.value)}
              placeholder={nameFilterPlaceholder}
              className="h-8 pl-7 text-[13px]"
              data-testid="schema-diff-table-filter"
            />
          </div>
        ) : null}
      </div>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              variant="filtered-empty"
              compact
              title="No tables match"
              description="Try a different filter or switch to All."
            />
          </div>
        ) : (
          <div
            className="max-h-[min(36rem,70vh)] overflow-y-auto py-1"
            role="tree"
            aria-label="Tables by database"
          >
            {groups.map((group) => {
              const open = filtering || !collapsed.has(group.database)
              return (
                <Collapsible
                  key={group.database}
                  open={open}
                  onOpenChange={(next) => {
                    setCollapsed((prev) => {
                      const copy = new Set(prev)
                      if (next) copy.delete(group.database)
                      else copy.add(group.database)
                      return copy
                    })
                  }}
                >
                  <CollapsibleTrigger
                    render={
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[13px] font-medium hover:bg-muted"
                        data-testid={`schema-diff-db-${group.database}`}
                      />
                    }
                  >
                    <ChevronRightIcon
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        open && 'rotate-90'
                      )}
                      strokeWidth={1.5}
                    />
                    <DatabaseIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 truncate">{group.database}</span>
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {group.tables.length}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul>
                      {group.tables.map((row) => {
                        const table = tableNameOf(row)
                        return (
                          <li key={row.key}>
                            <button
                              type="button"
                              className={cn(
                                'flex w-full items-center justify-between gap-2 py-1 pr-2 pl-7 text-left text-[13px] hover:bg-muted',
                                selectedKey === row.key && 'bg-muted'
                              )}
                              aria-current={
                                selectedKey === row.key ? 'true' : undefined
                              }
                              aria-label={row.key}
                              data-testid={`schema-diff-table-${row.key}`}
                              onClick={() => onSelect(row.key)}
                            >
                              <span className="truncate font-mono">
                                {table}
                              </span>
                              <KindMark row={row} example={example} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
