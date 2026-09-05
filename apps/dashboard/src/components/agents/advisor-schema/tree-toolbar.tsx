'use client'

import {
  ArrowDownAZIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpZAIcon,
  DatabaseIcon,
  EyeOffIcon,
  LayersIcon,
  ListIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import type {
  AdvisorTreeGroup,
  AdvisorTreeSort,
  AdvisorTreeVisibility,
} from '@/lib/ai/advisor/schema-tree'

import { IconToolButton } from './icon-tool-button'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'

export function TreeToolbar({
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
