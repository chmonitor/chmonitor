'use client'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  TableIcon,
} from 'lucide-react'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

function ChevronToggle({ open }: { open: boolean }) {
  return open ? (
    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
  )
}

export interface DataSource {
  database: string
  table: string
  engine: string
  totalRows: number
  size: string
  comment: string
  matchedColumns?: Array<{ name: string; type: string }>
  measures: Array<{ name: string; type: string }>
  dimensions: Array<{ name: string; type: string }>
}

export interface AgentDataSourcesProps {
  searchTerm: string
  sources: DataSource[]
}

function ColumnList({
  columns,
}: {
  columns: Array<{ name: string; type: string }>
}) {
  return (
    <div className="space-y-1">
      {columns.map((col) => (
        <div
          key={col.name}
          className="flex items-baseline justify-between gap-x-4"
        >
          <span className="text-xs font-medium text-foreground truncate">
            {col.name}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground shrink-0">
            {col.type}
          </span>
        </div>
      ))}
    </div>
  )
}

function SectionHeading({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
      {label}
    </p>
  )
}

function DataSourceItem({
  source,
  defaultOpen,
}: {
  source: DataSource
  defaultOpen: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left',
              'hover:bg-muted/30 transition-colors',
              isOpen && 'bg-muted/20'
            )}
          />
        }
      >
        <ChevronToggle open={isOpen} />

        <TableIcon className="size-3.5 shrink-0 text-muted-foreground" />

        <span className="flex-1 min-w-0 text-xs font-semibold text-foreground truncate">
          {source.database}.{source.table}
        </span>

        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] font-normal"
        >
          {source.engine}
        </Badge>

        <span className="shrink-0 text-[11px] text-muted-foreground">
          {source.size}
        </span>

        <span className="shrink-0 text-[11px] text-muted-foreground">
          {source.totalRows.toLocaleString()} rows
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 py-3 border-t border-border/40 bg-background/50 space-y-3">
          {source.comment && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {source.comment}
            </p>
          )}

          {source.matchedColumns && source.matchedColumns.length > 0 && (
            <div>
              <SectionHeading label="Matched Columns" />
              <ColumnList columns={source.matchedColumns} />
            </div>
          )}

          {source.measures.length > 0 && (
            <div>
              <SectionHeading label="Measures" />
              <ColumnList columns={source.measures} />
            </div>
          )}

          {source.dimensions.length > 0 && (
            <div>
              <SectionHeading label="Dimensions" />
              <ColumnList columns={source.dimensions} />
            </div>
          )}

          {source.measures.length === 0 && source.dimensions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No column schema available.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AgentDataSources({
  searchTerm,
  sources,
}: AgentDataSourcesProps) {
  const [isGroupOpen, setIsGroupOpen] = useState(true)

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 overflow-hidden">
      <Collapsible open={isGroupOpen} onOpenChange={setIsGroupOpen}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
            />
          }
        >
          <ChevronToggle open={isGroupOpen} />

          <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />

          <span className="text-xs font-medium text-foreground">
            Discovered sources
          </span>

          {searchTerm && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {searchTerm}
            </Badge>
          )}

          <Badge
            variant="secondary"
            className="px-1.5 py-0 text-[10px] font-normal"
          >
            {sources.length} {sources.length === 1 ? 'table' : 'tables'}
          </Badge>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {sources.length === 0 ? (
            <div className="px-4 py-3 border-t border-border/40 text-xs text-muted-foreground italic">
              No matching tables found.
            </div>
          ) : (
            <div className="border-t border-border/40 divide-y divide-border/30">
              {sources.map((source, index) => (
                <DataSourceItem
                  key={`${source.database}.${source.table}`}
                  source={source}
                  defaultOpen={index === 0}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
