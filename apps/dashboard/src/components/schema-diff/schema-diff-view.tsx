import { Loader2Icon, PanelLeftIcon } from 'lucide-react'

import type { ComparePeer, CompareScope } from '@/lib/compare/scope'
import type { SchemaDiffResponse, TableDiff } from '@/lib/schema-diff'

import { DdlPair } from './ddl-pair'
import { PlanList } from './plan-list'
import { TableList } from './table-list'
import { useMemo, useState } from 'react'
import { CompareScopeToggle } from '@/components/compare/compare-scope-toggle'
import { CompareToolbar } from '@/components/compare/compare-toolbar'
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
  listingLoading?: boolean
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
  listingLoading = false,
}: SchemaDiffViewProps) {
  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [nameFilter, setNameFilter] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [copiedSafe, setCopiedSafe] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const diffCount =
    data.diff.onlySource.length +
    data.diff.onlyTarget.length +
    data.diff.changed.length
  const allMatched = diffCount === 0 && data.diff.identical.length > 0

  const rows: TableDiff[] = useMemo(() => {
    const diffs = [
      ...data.diff.onlySource,
      ...data.diff.onlyTarget,
      ...data.diff.changed,
    ]
    // Differences with zero deltas still lists matching tables so the
    // sidebar is a real catalog, not an empty "no data" card.
    const includeIdentical = !showDiffsOnly || diffs.length === 0
    const all = includeIdentical ? [...diffs, ...data.diff.identical] : diffs
    if (!nameFilter) return all
    const q = nameFilter.toLowerCase()
    return all.filter((row) => row.key.toLowerCase().includes(q))
  }, [data, nameFilter, showDiffsOnly])

  const selected = rows.find((r) => r.key === selectedKey) ?? rows[0] ?? null
  const selectedPlan = (data.plan.items ?? []).filter(
    (item) => item.tableKey === selected?.key
  )
  const selectedMatches = selected?.kind === 'identical'

  const hasNameFilter = nameFilter.trim().length > 0
  const hasSafeStatements = data.plan.safeStatements.length > 0
  const sourceName = peers.find((peer) => peer.id === sourceId)?.name
  const targetName = peers.find((peer) => peer.id === targetId)?.name

  const copySafe = async () => {
    const text = data.plan.safeStatements.join(';\n\n')
    if (!text) return
    await copyToClipboard(text)
    setCopiedSafe(true)
    window.setTimeout(() => setCopiedSafe(false), 1500)
  }

  return (
    <div className="flex flex-col gap-3">
      <CompareToolbar className="gap-2 p-2 sm:flex-row sm:items-center sm:justify-between">
        {onScopeChange ? (
          <div className="flex items-center gap-2">
            <CompareScopeToggle
              value={scope}
              onChange={onScopeChange}
              hostCount={hostCount}
              nodeCount={nodeCount}
            />
            {listingLoading ? (
              <Loader2Icon
                className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : null}
          </div>
        ) : null}
        <HostPairFilter
          compact
          className="min-w-0"
          hosts={peers}
          sourceHostId={sourceId}
          targetHostId={targetId}
          onPairChange={onPairChange}
        />
      </CompareToolbar>

      {listingLoading ? (
        <div
          className="flex min-h-64 items-center justify-center rounded-xl border bg-card shadow-sm"
          data-testid="schema-diff-listing-loading"
          role="status"
          aria-busy="true"
          aria-label="Loading comparison"
        >
          <EmptyState
            variant="loading"
            compact
            title="Loading comparison"
            description="Fetching schemas for the selected pair."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {sidebarOpen ? (
            <div className="flex w-full shrink-0 flex-col lg:w-[22rem]">
              <TableList
                rows={rows}
                selectedKey={selected?.key ?? null}
                onSelect={setSelectedKey}
                example={example}
                nameFilter={nameFilter}
                onNameFilterChange={setNameFilter}
                nameFilterPlaceholder={nameFilterPlaceholder}
                showDiffsOnly={showDiffsOnly}
                onShowDiffsOnlyChange={setShowDiffsOnly}
                onCollapse={() => setSidebarOpen(false)}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setSidebarOpen(true)}
              className="size-8 shrink-0 self-start text-muted-foreground hover:text-foreground"
              aria-label="Show table list"
              data-testid="schema-diff-sidebar-expand"
            >
              <PanelLeftIcon className="size-3.5" strokeWidth={1.5} />
            </Button>
          )}

          <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col gap-3">
            {selected ? (
              <>
                <DdlPair
                  selected={selected}
                  sourceLabel={sourceName}
                  targetLabel={targetName}
                  allMatched={allMatched && selectedMatches}
                />
                {selectedMatches ? null : (
                  <PlanList
                    items={selectedPlan}
                    onCopyRecommended={() => void copySafe()}
                    copyRecommendedLabel={
                      copiedSafe ? 'Copied' : 'Copy recommended SQL'
                    }
                    copyRecommendedDisabled={!hasSafeStatements}
                  />
                )}
              </>
            ) : allMatched && !hasNameFilter ? (
              <DdlPair
                selected={{
                  key: '',
                  kind: 'identical',
                  changes: [],
                }}
                sourceLabel={sourceName}
                targetLabel={targetName}
                allMatched
              />
            ) : (
              <EmptyState
                variant={hasNameFilter ? 'filtered-empty' : 'no-data'}
                title={hasNameFilter ? 'No tables match' : 'Select a table'}
                description={
                  hasNameFilter
                    ? 'Try a different filter or switch to All.'
                    : 'Pick a table on the left to see side-by-side DDL and a copyable plan.'
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
