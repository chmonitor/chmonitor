import { CopyIcon, PanelLeftIcon } from 'lucide-react'

import type { ComparePeer, CompareScope } from '@/lib/compare/scope'
import type { SchemaDiffResponse, TableDiff } from '@/lib/schema-diff'

import { DdlPair } from './ddl-pair'
import { MatchOk } from './match-ok'
import { PlanList } from './plan-list'
import { TableList } from './table-list'
import { useMemo, useState } from 'react'
import { CompareScopeToggle } from '@/components/compare/compare-scope-toggle'
import { CompareToolbar } from '@/components/compare/compare-toolbar'
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

  const copySafe = async () => {
    const text = data.plan.safeStatements.join(';\n\n')
    if (!text) return
    await copyToClipboard(text)
    setCopiedSafe(true)
    window.setTimeout(() => setCopiedSafe(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <CompareToolbar
        tabs={
          onScopeChange ? (
            <CompareScopeToggle
              value={scope}
              onChange={onScopeChange}
              hostCount={hostCount}
              nodeCount={nodeCount}
            />
          ) : null
        }
      >
        <HostPairFilter
          hosts={peers}
          sourceHostId={sourceId}
          targetHostId={targetId}
          onPairChange={onPairChange}
          extraFilters={
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
                        className="h-8 text-[13px]"
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
          }
        />
      </CompareToolbar>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {sidebarOpen ? (
          <div className="w-full shrink-0 lg:w-[22rem]">
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
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Show table list"
            data-testid="schema-diff-sidebar-expand"
          >
            <PanelLeftIcon className="size-3.5" strokeWidth={1.5} />
          </Button>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {selected ? (
            <>
              {selectedMatches ? (
                <MatchOk
                  title={allMatched ? 'All matched' : 'This table matches'}
                  description={
                    allMatched
                      ? 'Every table schema is identical on source and target.'
                      : 'Source and target DDL are identical. No recommended statements.'
                  }
                />
              ) : null}
              <DdlPair selected={selected} />
              {selectedMatches ? null : <PlanList items={selectedPlan} />}
            </>
          ) : allMatched && !hasNameFilter ? (
            <MatchOk
              title="All matched"
              description="Every table schema is identical on source and target."
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
    </div>
  )
}
