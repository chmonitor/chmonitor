import { CopyIcon } from 'lucide-react'

import type { ComparePeer, CompareScope } from '@/lib/compare/scope'
import type { SchemaDiffResponse, TableDiff } from '@/lib/schema-diff'

import { DdlPair } from './ddl-pair'
import { PlanList } from './plan-list'
import { TableList } from './table-list'
import { useMemo, useState } from 'react'
import { CompareScopeToggle } from '@/components/compare/compare-scope-toggle'
import { HostPairFilter } from '@/components/compare/host-pair-filter'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/utils/clipboard'

export interface SchemaDiffViewProps {
  data: SchemaDiffResponse
  sourceId: number
  targetId: number
  scope: CompareScope
  peers: ComparePeer[]
  hostCount: number
  nodeCount: number
  onPairChange: (source: number, target: number) => void
  onScopeChange?: (scope: CompareScope) => void
  nameFilterPlaceholder?: string
  example?: boolean
}

export function SchemaDiffView({
  data,
  sourceId,
  targetId,
  scope,
  peers,
  hostCount,
  nodeCount,
  onPairChange,
  onScopeChange,
  nameFilterPlaceholder,
  example = false,
}: SchemaDiffViewProps) {
  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [nameFilter, setNameFilter] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [copiedSafe, setCopiedSafe] = useState(false)

  const rows: TableDiff[] = useMemo(() => {
    const all = [
      ...data.diff.onlySource,
      ...data.diff.onlyTarget,
      ...data.diff.changed,
      ...(showDiffsOnly ? [] : data.diff.identical),
    ]
    if (!nameFilter) return all
    const q = nameFilter.toLowerCase()
    return all.filter((row) => row.key.toLowerCase().includes(q))
  }, [data, nameFilter, showDiffsOnly])

  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0] ?? null
  const selectedPlan = (data.plan.items ?? []).filter(
    (item) => item.tableKey === selected?.key
  )

  const diffCount =
    data.diff.onlySource.length +
    data.diff.onlyTarget.length +
    data.diff.changed.length
  const hasNameFilter = nameFilter.trim().length > 0
  const schemasMatchEmpty =
    rows.length === 0 && showDiffsOnly && diffCount === 0 && !hasNameFilter
  const hasSafeStatements = data.plan.safeStatements.length > 0

  const copySafe = async () => {
    const text = data.plan.safeStatements.join(';\n\n')
    if (!text) return
    await copyToClipboard(text)
    setCopiedSafe(true)
    window.setTimeout(() => setCopiedSafe(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <HostPairFilter
          hosts={peers}
          sourceHostId={sourceId}
          targetHostId={targetId}
          nameFilter={nameFilter}
          nameFilterPlaceholder={nameFilterPlaceholder}
          showDiffsOnly={showDiffsOnly}
          onPairChange={onPairChange}
          onNameFilterChange={setNameFilter}
          onShowDiffsOnlyChange={setShowDiffsOnly}
        />
        <div className="flex flex-wrap items-center gap-2">
          {onScopeChange ? (
            <CompareScopeToggle
              value={scope}
              onChange={onScopeChange}
              hostCount={hostCount}
              nodeCount={nodeCount}
            />
          ) : null}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copySafe}
                      disabled={!hasSafeStatements}
                      aria-label="Copy recommended SQL"
                    >
                      <CopyIcon className="mr-2 size-3.5" strokeWidth={1.5} />
                      {copiedSafe ? 'Copied' : 'Copy recommended SQL'}
                    </Button>
                  </span>
                }
              />
              <TooltipContent side="top" className="max-w-xs">
                {hasSafeStatements
                  ? 'Copy recommended ALTER/CREATE statements. Nothing is applied.'
                  : 'No recommended SQL — schemas match or every change is a manual rewrite.'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <TableList
          rows={rows}
          selectedKey={selected?.key ?? null}
          onSelect={setSelectedKey}
          example={example}
          emptyTitle={schemasMatchEmpty ? 'Schemas match' : undefined}
          emptyDescription={
            schemasMatchEmpty
              ? 'No table differences between source and target. Turn off Differences only to list every table.'
              : undefined
          }
          emptyVariant={schemasMatchEmpty ? 'no-data' : undefined}
          emptyCompact={!schemasMatchEmpty}
        />

        <div className="flex flex-col gap-4">
          {selected ? (
            <>
              <DdlPair selected={selected} />
              <PlanList items={selectedPlan} />
            </>
          ) : (
            <EmptyState
              variant="no-data"
              title="Select a table"
              description="Pick a table on the left to see side-by-side DDL and a copyable plan."
            />
          )}
        </div>
      </div>
    </div>
  )
}
