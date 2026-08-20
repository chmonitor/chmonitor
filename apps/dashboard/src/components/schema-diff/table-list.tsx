import {
  ArrowDownAZIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpZAIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  DatabaseIcon,
  FoldVerticalIcon,
  GitCompareArrowsIcon,
  ListIcon,
  PanelLeftCloseIcon,
  SearchIcon,
  UnfoldVerticalIcon,
} from 'lucide-react'

import type { ReactNode } from 'react'
import type { TableDiff } from '@/lib/schema-diff'
import type { TableSort } from '@/lib/schema-diff/group'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
  showDiffsOnly?: boolean
  onShowDiffsOnlyChange?: (value: boolean) => void
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

export function TableList({
  rows,
  selectedKey,
  onSelect,
  example = false,
  nameFilter = '',
  onNameFilterChange,
  nameFilterPlaceholder = 'Filter tables…',
  showDiffsOnly,
  onShowDiffsOnlyChange,
  onCollapse,
}: TableListProps) {
  const [sort, setSort] = useState<TableSort>('name-asc')
  const groups = useMemo(() => groupDiffsByDatabase(rows, sort), [rows, sort])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const filtering = nameFilter.trim().length > 0
  const allCollapsed =
    groups.length > 0 && groups.every((group) => collapsed.has(group.database))
  const toggleDatabases = () => {
    setCollapsed((prev) => {
      if (groups.every((group) => prev.has(group.database))) {
        return new Set()
      }
      return new Set(groups.map((group) => group.database))
    })
  }
  const SortIcon =
    sort === 'name-desc'
      ? ArrowUpZAIcon
      : sort === 'kind'
        ? ArrowDownWideNarrowIcon
        : ArrowDownAZIcon

  return (
    <Card
      className="flex h-full min-h-[32rem] flex-col gap-0 overflow-hidden rounded-xl border bg-card py-0 shadow-sm"
      data-testid="schema-diff-table-list"
    >
      <TooltipProvider>
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
            <div className="flex items-center gap-0.5">
              {onShowDiffsOnlyChange ? (
                <div className="mr-0.5 inline-flex rounded-md border border-border/60 p-0.5">
                  <IconToolButton
                    label="Differences"
                    pressed={showDiffsOnly}
                    testId="schema-diff-filter-diffs"
                    onClick={() => onShowDiffsOnlyChange(true)}
                  >
                    <GitCompareArrowsIcon
                      className="size-3.5"
                      strokeWidth={1.5}
                    />
                  </IconToolButton>
                  <IconToolButton
                    label="All tables"
                    pressed={!showDiffsOnly}
                    testId="schema-diff-filter-all"
                    onClick={() => onShowDiffsOnlyChange(false)}
                  >
                    <ListIcon className="size-3.5" strokeWidth={1.5} />
                  </IconToolButton>
                </div>
              ) : null}
              {groups.length > 0 ? (
                <IconToolButton
                  label={
                    allCollapsed
                      ? 'Expand databases'
                      : 'Collapse tables into databases'
                  }
                  pressed={allCollapsed}
                  testId="schema-diff-collapse-databases"
                  onClick={toggleDatabases}
                >
                  {allCollapsed ? (
                    <UnfoldVerticalIcon
                      className="size-3.5"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <FoldVerticalIcon className="size-3.5" strokeWidth={1.5} />
                  )}
                </IconToolButton>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Sort tables"
                      title="Sort"
                      data-testid="schema-diff-sort"
                      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <SortIcon className="size-3.5" strokeWidth={1.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-40">
                  <DropdownMenuItem
                    onClick={() => setSort('name-asc')}
                    data-testid="schema-diff-sort-az"
                  >
                    <ArrowDownAZIcon className="size-3.5" strokeWidth={1.5} />A
                    to Z
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSort('name-desc')}
                    data-testid="schema-diff-sort-za"
                  >
                    <ArrowUpZAIcon className="size-3.5" strokeWidth={1.5} />Z to
                    A
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSort('kind')}
                    data-testid="schema-diff-sort-kind"
                  >
                    <ArrowDownWideNarrowIcon
                      className="size-3.5"
                      strokeWidth={1.5}
                    />
                    Differences first
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {onCollapse ? (
                <IconToolButton
                  label="Hide table list"
                  testId="schema-diff-sidebar-collapse"
                  onClick={onCollapse}
                >
                  <PanelLeftCloseIcon className="size-3.5" strokeWidth={1.5} />
                </IconToolButton>
              ) : null}
            </div>
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
      </TooltipProvider>
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              variant="filtered-empty"
              compact
              title="No tables match"
              description="Try a different filter or show all tables."
            />
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-y-auto py-1"
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
