import { PlusIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import type { CompareScope } from '@/lib/compare/scope'
import type { SchemaDiffResponse } from '@/lib/schema-diff'

import { DdlPair } from './ddl-pair'
import { SchemaDiffView } from './schema-diff-view'
import { TableList } from './table-list'
import { useMemo, useState } from 'react'
import { ExamplePreviewChrome } from '@/components/compare/example-preview-chrome'
import { AddHostDialog } from '@/components/connections'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  collectBrowserDiffSessions,
  fetchCompareDiff,
} from '@/lib/compare/fetch-diff-request'
import {
  canComparePair,
  resolveCompareScope,
  resolvePair,
} from '@/lib/compare/scope'
import { buildExampleSchemaDiff } from '@/lib/schema-diff'
import { useHostId } from '@/lib/swr/use-host'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { buildUrl } from '@/lib/url/url-builder'

const PAGE_DESCRIPTION =
  'Compare table schemas across hosts or cluster nodes. Recommend only — copy a sync script, never apply.'

export function SchemaDiffPage() {
  const hostId = useHostId()
  const navigate = useNavigate()
  const search = useSearch({ from: '/(dashboard)/schema-diff' })
  const {
    hosts: mergedHosts,
    getConnectionByHostId,
    isLoading: hostsLoading,
  } = useMergedHosts()
  const [addOpen, setAddOpen] = useState(false)

  const sourceParam = Number.isFinite(search.source) ? search.source : undefined
  const targetParam = Number.isFinite(search.target) ? search.target : undefined
  const scopeParam = search.scope
  const hostKey = mergedHosts.map((h) => `${h.source}:${h.id}`).join('|')

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: [
      'schema-diff',
      hostId,
      sourceParam,
      targetParam,
      scopeParam,
      hostKey,
    ],
    queryFn: async () => {
      const browserSessions = await collectBrowserDiffSessions(
        mergedHosts,
        getConnectionByHostId
      )
      return fetchCompareDiff<SchemaDiffResponse>({
        path: '/api/v1/schema-diff',
        search: {
          host: search.host ?? hostId,
          source: sourceParam,
          target: targetParam,
          scope: scopeParam,
        },
        browserSessions,
      })
    },
    enabled: !hostsLoading,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })
  const listingLoading = isFetching && isPlaceholderData

  const example = useMemo(() => buildExampleSchemaDiff(), [])
  const exampleRows = useMemo(
    () => [
      ...example.diff.onlySource,
      ...example.diff.onlyTarget,
      ...example.diff.changed,
    ],
    [example]
  )
  const exampleSelected = exampleRows[0] ?? null

  const setPair = (source: number, target: number, scope: CompareScope) => {
    navigate({
      href: buildUrl(
        '/schema-diff',
        { host: search.host ?? hostId, source, target, scope },
        undefined
      ),
      replace: true,
    })
  }

  if ((hostsLoading || isLoading) && !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
        <EmptyState variant="loading" compact />
      </div>
    )
  }

  if (error || !data?.success) {
    const message =
      error instanceof Error
        ? error.message
        : (data?.error ?? 'Failed to load schema diff')
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
        <EmptyState
          variant="error"
          title="Failed to load schema diff"
          description={message}
        />
      </div>
    )
  }

  const hosts = data.hosts ?? []
  const nodes = data.nodes ?? []
  const hostCount = hosts.length
  const nodeCount = nodes.length

  if (!canComparePair(hostCount, nodeCount)) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
        <EmptyState
          variant="no-data"
          title="Need two saved connections"
          description="Schema Compare diffs staging vs prod. Add another host, or compare replica nodes when this cluster has two or more."
          action={{
            label: 'Add host',
            onClick: () => setAddOpen(true),
            icon: (
              <span data-testid="add-host" className="contents">
                <PlusIcon className="size-3.5" strokeWidth={1.5} />
              </span>
            ),
          }}
        />
        <ExamplePreviewChrome>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            <div className="w-full shrink-0 lg:w-[22rem]">
              <TableList
                rows={exampleRows}
                selectedKey={exampleSelected?.key ?? null}
                onSelect={() => {}}
                example
              />
            </div>
            {exampleSelected ? (
              <DdlPair
                selected={exampleSelected}
                sourceLabel="Host A"
                targetLabel="Host B"
              />
            ) : null}
          </div>
        </ExamplePreviewChrome>
        <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
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
  if (!pair) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
        <EmptyState
          variant="no-data"
          title="Need two saved connections"
          description="Schema Compare diffs staging vs prod. Add another host, or compare replica nodes when this cluster has two or more."
          action={{
            label: 'Add host',
            onClick: () => setAddOpen(true),
            icon: (
              <span data-testid="add-host" className="contents">
                <PlusIcon className="size-3.5" strokeWidth={1.5} />
              </span>
            ),
          }}
        />
        <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
      <SchemaDiffView
        data={data}
        sourceId={pair.sourceId}
        targetId={pair.targetId}
        scope={scope}
        peers={peers}
        hostCount={hostCount}
        nodeCount={nodeCount}
        nameFilterPlaceholder={scope === 'nodes' ? 'Filter tables…' : undefined}
        listingLoading={listingLoading}
        onPairChange={(source, target) => setPair(source, target, scope)}
        onScopeChange={(next) => {
          const nextPeers = next === 'nodes' ? nodes : hosts
          const nextPair = resolvePair(nextPeers)
          if (!nextPair) return
          setPair(nextPair.sourceId, nextPair.targetId, next)
        }}
      />
    </div>
  )
}
