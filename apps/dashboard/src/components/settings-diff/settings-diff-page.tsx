import { Loader2Icon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import type { CompareScope } from '@/lib/compare/scope'
import type {
  SettingsDiffResponse,
  SettingsDiffView,
} from '@/lib/settings-diff/types'

import { SettingsDiffTable } from './settings-diff-table'
import { useState } from 'react'
import { AddHostButton } from '@/components/compare/add-host-button'
import { CompareScopeToggle } from '@/components/compare/compare-scope-toggle'
import { CompareToolbar } from '@/components/compare/compare-toolbar'
import { HostPairFilter } from '@/components/compare/host-pair-filter'
import { SettingsViewToggle } from '@/components/compare/settings-view-toggle'
import { SegmentedControl } from '@/components/filters/segmented-control'
import { PageHeader } from '@/components/layout/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  collectBrowserDiffSessions,
  fetchCompareDiff,
} from '@/lib/compare/fetch-diff-request'
import { resolveCompareScope, resolvePair } from '@/lib/compare/scope'
import { filterSettingsDiffRows } from '@/lib/settings-diff/filter'
import { useHostId } from '@/lib/swr/use-host'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { buildUrl } from '@/lib/url/url-builder'

const PAGE_DESCRIPTION =
  'Compare system.settings and merge_tree_settings across hosts or cluster nodes. Read-only.'

export function SettingsDiffPage() {
  const hostId = useHostId()
  const navigate = useNavigate()
  const search = useSearch({ from: '/(dashboard)/settings-diff' })
  const {
    hosts: mergedHosts,
    getConnectionByHostId,
    isLoading: hostsLoading,
  } = useMergedHosts()

  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [showChangedOnly, setShowChangedOnly] = useState(false)

  const sourceParam = Number.isFinite(search.source) ? search.source : undefined
  const targetParam = Number.isFinite(search.target) ? search.target : undefined
  const scopeParam = search.scope
  const viewParam = search.view
  const hostKey = mergedHosts.map((h) => `${h.source}:${h.id}`).join('|')

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: [
      'settings-diff',
      hostId,
      sourceParam,
      targetParam,
      scopeParam,
      viewParam,
      hostKey,
    ],
    queryFn: async () => {
      const browserSessions = await collectBrowserDiffSessions(
        mergedHosts,
        getConnectionByHostId
      )
      return fetchCompareDiff<SettingsDiffResponse>({
        path: '/api/v1/settings-diff',
        search: {
          host: search.host ?? hostId,
          source: sourceParam,
          target: targetParam,
          scope: scopeParam,
          view: viewParam,
        },
        browserSessions,
      })
    },
    enabled: !hostsLoading,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })
  const listingLoading = isFetching && isPlaceholderData

  const setSearch = (next: {
    source?: number
    target?: number
    scope?: CompareScope
    view?: SettingsDiffView
  }) => {
    navigate({
      href: buildUrl(
        '/settings-diff',
        {
          host: search.host ?? hostId,
          source: next.source,
          target: next.target,
          scope: next.scope,
          view: next.view,
        },
        undefined
      ),
      replace: true,
    })
  }

  if ((hostsLoading || isLoading) && !data) {
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

  if (hostCount === 0 && nodeCount < 2) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings Diff" description={PAGE_DESCRIPTION} />
        <EmptyState
          variant="no-data"
          title="No hosts to compare"
          description="Add a host to compare settings against defaults, or add a second host to diff two nodes."
        />
        <div className="flex justify-center">
          <AddHostButton />
        </div>
      </div>
    )
  }

  const scope = resolveCompareScope({
    hostCount,
    nodeCount,
    requested: data.scope ?? scopeParam,
  })
  const view: SettingsDiffView =
    data.view ??
    viewParam ??
    (hostCount >= 2 && sourceParam !== undefined && targetParam !== undefined
      ? 'pair'
      : 'matrix')
  const peers = scope === 'nodes' ? nodes : hosts
  const pair = resolvePair(
    peers,
    data.sourceHostId ?? sourceParam,
    data.targetHostId ?? targetParam
  )
  const pairMode = scope === 'nodes' || (scope === 'hosts' && view === 'pair')
  const columns =
    pairMode && pair
      ? peers.filter((p) => p.id === pair.sourceId || p.id === pair.targetId)
      : hosts

  const diffsOnly = hostCount === 1 ? false : showDiffsOnly
  const filteredRows = filterSettingsDiffRows(data.rows ?? [], {
    showDiffsOnly: diffsOnly,
    showChangedOnly,
    nameFilter: '',
  })
  const oneHostVsDefault = hostCount === 1 && scope === 'hosts'

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings Diff"
        description={
          oneHostVsDefault
            ? 'Comparing this host against setting defaults'
            : PAGE_DESCRIPTION
        }
      />

      {oneHostVsDefault ? (
        <Alert>
          <AlertTitle>Comparing against defaults</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              This host is compared to setting defaults. Add host to diff
              another node.
            </p>
            <AddHostButton variant="outline" className="shrink-0" />
          </AlertDescription>
        </Alert>
      ) : null}

      <CompareToolbar
        tabs={
          <>
            <div className="flex items-center gap-2">
              <CompareScopeToggle
                value={scope}
                onChange={(next) => {
                  const nextPeers = next === 'nodes' ? nodes : hosts
                  const nextPair = resolvePair(nextPeers)
                  if (!nextPair) return
                  setSearch({
                    source: nextPair.sourceId,
                    target: nextPair.targetId,
                    scope: next,
                    view: next === 'hosts' ? view : undefined,
                  })
                }}
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
            {scope === 'hosts' ? (
              <SettingsViewToggle
                value={view}
                hostCount={hostCount}
                onChange={(next) => {
                  if (next === 'pair') {
                    const nextPair = resolvePair(
                      hosts,
                      sourceParam,
                      targetParam
                    )
                    if (!nextPair) return
                    setSearch({
                      source: nextPair.sourceId,
                      target: nextPair.targetId,
                      scope: 'hosts',
                      view: 'pair',
                    })
                    return
                  }
                  setSearch({ scope: 'hosts', view: 'matrix' })
                }}
              />
            ) : null}
          </>
        }
      >
        {pairMode && pair ? (
          <HostPairFilter
            hosts={peers}
            sourceHostId={pair.sourceId}
            targetHostId={pair.targetId}
            onPairChange={(source, target) =>
              setSearch({
                source,
                target,
                scope,
                view: scope === 'hosts' ? 'pair' : undefined,
              })
            }
          />
        ) : null}
      </CompareToolbar>

      {listingLoading ? (
        <div
          className="flex min-h-64 items-center justify-center rounded-xl border bg-card shadow-sm"
          data-testid="settings-diff-listing-loading"
          role="status"
          aria-busy="true"
          aria-label="Loading comparison"
        >
          <EmptyState
            variant="loading"
            compact
            title="Loading comparison"
            description="Fetching settings for the selected pair."
          />
        </div>
      ) : (
        <SettingsDiffTable
          columns={columns}
          rows={filteredRows}
          toolbarExtras={
            <>
              {hostCount > 1 ? (
                <SegmentedControl
                  size="sm"
                  ariaLabel="Show differences or all rows"
                  value={showDiffsOnly ? 'diffs' : 'all'}
                  onChange={(next) => setShowDiffsOnly(next === 'diffs')}
                  options={[
                    { label: 'Differences', value: 'diffs' },
                    { label: 'All', value: 'all' },
                  ]}
                />
              ) : null}
              <ChangedFromDefaultChip
                pressed={showChangedOnly}
                onPressedChange={setShowChangedOnly}
              />
            </>
          }
        />
      )}
    </div>
  )
}

function ChangedFromDefaultChip({
  pressed,
  onPressedChange,
}: {
  pressed: boolean
  onPressedChange: (next: boolean) => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? 'secondary' : 'outline'}
      aria-pressed={pressed}
      className="h-8 rounded-md text-[13px]"
      data-testid="settings-diff-changed-from-default"
      onClick={() => onPressedChange(!pressed)}
    >
      Changed from default
    </Button>
  )
}
