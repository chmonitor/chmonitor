import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import type { CompareScope } from '@/lib/compare/scope'
import type { SettingsDiffResponse } from '@/lib/settings-diff/types'

import { SettingsCsvButton, SettingsDiffTable } from './settings-diff-table'
import { useMemo, useState } from 'react'
import { CompareScopeToggle } from '@/components/compare/compare-scope-toggle'
import { ExamplePreviewChrome } from '@/components/compare/example-preview-chrome'
import { HostPairFilter } from '@/components/compare/host-pair-filter'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  canComparePair,
  resolveCompareScope,
  resolvePair,
} from '@/lib/compare/scope'
import { buildExampleSettingsDiff } from '@/lib/settings-diff/example'
import { filterSettingsDiffRows } from '@/lib/settings-diff/filter'
import { buildSettingsDiffRequest } from '@/lib/settings-diff/search'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'

const PAGE_DESCRIPTION =
  'Compare system.settings and merge_tree_settings across hosts or cluster nodes. Read-only.'

async function fetchSettingsDiff(search: {
  host: number
  source?: number
  target?: number
  scope?: CompareScope
}): Promise<SettingsDiffResponse> {
  const res = await apiFetch(buildSettingsDiffRequest(search))
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ??
        `Request failed (${res.status} ${res.statusText})`
    )
  }
  return res.json()
}

export function SettingsDiffPage() {
  const hostId = useHostId()
  const navigate = useNavigate()
  const search = useSearch({ from: '/(dashboard)/settings-diff' })

  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [showChangedOnly, setShowChangedOnly] = useState(false)
  const [nameFilter, setNameFilter] = useState('')
  const [exampleSource, setExampleSource] = useState(0)
  const [exampleTarget, setExampleTarget] = useState(1)

  const sourceParam = Number.isFinite(search.source) ? search.source : undefined
  const targetParam = Number.isFinite(search.target) ? search.target : undefined
  const scopeParam = search.scope

  const { data, isLoading, error } = useQuery({
    queryKey: ['settings-diff', hostId, sourceParam, targetParam, scopeParam],
    queryFn: () =>
      fetchSettingsDiff({
        host: search.host ?? hostId,
        source: sourceParam,
        target: targetParam,
        scope: scopeParam,
      }),
    staleTime: 60_000,
  })

  const example = useMemo(() => buildExampleSettingsDiff(), [])

  const setPair = (source: number, target: number, scope: CompareScope) => {
    navigate({
      href: buildUrl(
        '/settings-diff',
        { host: search.host ?? hostId, source, target, scope },
        undefined
      ),
      replace: true,
    })
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings Diff" description={PAGE_DESCRIPTION} />
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading settings…
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data?.success) {
    const message =
      error instanceof Error
        ? error.message
        : (data?.error ?? 'Failed to load settings diff')
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings Diff" description={PAGE_DESCRIPTION} />
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">{message}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const hosts = data.hosts ?? []
  const nodes = data.nodes ?? []
  const hostCount = hosts.length
  const nodeCount = nodes.length

  if (!canComparePair(hostCount, nodeCount)) {
    const examplePair = resolvePair(example.hosts, exampleSource, exampleTarget)
    const exampleColumns = example.hosts
    const exampleRows = filterSettingsDiffRows(example.rows, {
      showDiffsOnly,
      showChangedOnly,
      nameFilter,
    })
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Settings Diff"
          description={PAGE_DESCRIPTION}
          actions={
            <SettingsCsvButton columns={exampleColumns} rows={exampleRows} />
          }
        />
        <ExamplePreviewChrome>
          <div className="flex flex-col gap-4">
            <HostPairFilter
              hosts={example.hosts}
              sourceHostId={examplePair?.sourceId ?? 0}
              targetHostId={examplePair?.targetId ?? 1}
              nameFilter={nameFilter}
              nameFilterPlaceholder="Filter by name…"
              showDiffsOnly={showDiffsOnly}
              diffsOnlyLabel="Show diffs only"
              onPairChange={(source, target) => {
                setExampleSource(source)
                setExampleTarget(target)
              }}
              onNameFilterChange={setNameFilter}
              onShowDiffsOnlyChange={setShowDiffsOnly}
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={showChangedOnly}
                onCheckedChange={setShowChangedOnly}
              />
              Show changed from default only
            </label>
            <SettingsDiffTable columns={exampleColumns} rows={exampleRows} />
          </div>
        </ExamplePreviewChrome>
      </div>
    )
  }

  const scope = resolveCompareScope({
    hostCount,
    nodeCount,
    requested: data.scope ?? scopeParam,
  })
  const peers = scope === 'nodes' ? nodes : hosts
  const pair = resolvePair(
    peers,
    data.sourceHostId ?? sourceParam,
    data.targetHostId ?? targetParam
  )
  const columns =
    scope === 'nodes' && pair
      ? peers.filter((p) => p.id === pair.sourceId || p.id === pair.targetId)
      : hosts

  const filteredRows = filterSettingsDiffRows(data.rows ?? [], {
    showDiffsOnly,
    showChangedOnly,
    nameFilter,
  })
  const diffCount = (data.rows ?? []).filter((r) => r.hasDiff).length

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings Diff"
        description={
          scope === 'nodes' && pair
            ? `Comparing cluster nodes — ${diffCount} setting${diffCount !== 1 ? 's' : ''} differ`
            : hosts.length > 1
              ? `Comparing ${hosts.length} hosts — ${diffCount} setting${diffCount !== 1 ? 's' : ''} differ`
              : PAGE_DESCRIPTION
        }
        actions={<SettingsCsvButton columns={columns} rows={filteredRows} />}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <CompareScopeToggle
            value={scope}
            onChange={(next) => {
              const nextPeers = next === 'nodes' ? nodes : hosts
              const nextPair = resolvePair(nextPeers)
              if (!nextPair) return
              setPair(nextPair.sourceId, nextPair.targetId, next)
            }}
            hostCount={hostCount}
            nodeCount={nodeCount}
          />
        </div>
        {scope === 'nodes' && pair ? (
          <HostPairFilter
            hosts={nodes}
            sourceHostId={pair.sourceId}
            targetHostId={pair.targetId}
            nameFilter={nameFilter}
            nameFilterPlaceholder="Filter by name…"
            showDiffsOnly={showDiffsOnly}
            diffsOnlyLabel="Show diffs only"
            onPairChange={(source, target) => setPair(source, target, 'nodes')}
            onNameFilterChange={setNameFilter}
            onShowDiffsOnlyChange={setShowDiffsOnly}
          />
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Input
              placeholder="Filter by name…"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="h-8 w-full sm:w-64"
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={showDiffsOnly}
                onCheckedChange={setShowDiffsOnly}
              />
              Show diffs only
            </label>
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch
            checked={showChangedOnly}
            onCheckedChange={setShowChangedOnly}
          />
          Show changed from default only
        </label>
      </div>

      <SettingsDiffTable columns={columns} rows={filteredRows} />

      <p className="text-xs text-muted-foreground">
        {filteredRows.length.toLocaleString()} row
        {filteredRows.length !== 1 ? 's' : ''}
        {filteredRows.length !== (data?.rows?.length ?? 0) &&
          ` (filtered from ${(data?.rows?.length ?? 0).toLocaleString()})`}
      </p>
    </div>
  )
}
