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

  const sourceHost = peers.find((h) => h.id === sourceId)
  const targetHost = peers.find((h) => h.id === targetId)
  const diffCount =
    data.diff.onlySource.length +
    data.diff.onlyTarget.length +
    data.diff.changed.length

  const copySafe = async () => {
    const text = data.plan.safeStatements.join(';\n\n')
    if (!text) return
    await copyToClipboard(text)
    setCopiedSafe(true)
    window.setTimeout(() => setCopiedSafe(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Comparing {sourceHost?.name ?? sourceId} →{' '}
          {targetHost?.name ?? targetId} — {diffCount} table
          {diffCount !== 1 ? 's' : ''} differ. Recommend only; copy statements,
          never apply.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onScopeChange ? (
            <CompareScopeToggle
              value={scope}
              onChange={onScopeChange}
              hostCount={hostCount}
              nodeCount={nodeCount}
            />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={copySafe}
            disabled={data.plan.safeStatements.length === 0}
          >
            <CopyIcon className="mr-2 size-3.5" strokeWidth={1.5} />
            {copiedSafe ? 'Copied' : 'Copy safe statements'}
          </Button>
        </div>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <TableList
          rows={rows}
          selectedKey={selected?.key ?? null}
          onSelect={setSelectedKey}
          example={example}
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
