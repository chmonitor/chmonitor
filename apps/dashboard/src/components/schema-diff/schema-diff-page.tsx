import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'

import type { CompareScope } from '@/lib/compare/scope'
import type { SchemaDiffResponse } from '@/lib/schema-diff'

import { SchemaDiffView } from './schema-diff-view'
import { useMemo, useState } from 'react'
import { ExamplePreviewChrome } from '@/components/compare/example-preview-chrome'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import {
  canComparePair,
  resolveCompareScope,
  resolvePair,
} from '@/lib/compare/scope'
import {
  buildExampleSchemaDiff,
  buildSchemaDiffRequest,
} from '@/lib/schema-diff'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'

const PAGE_DESCRIPTION =
  'Compare table schemas across hosts or cluster nodes. Recommend only — copy statements, never apply.'

async function fetchSchemaDiff(search: {
  host: number
  source?: number
  target?: number
  scope?: CompareScope
}): Promise<SchemaDiffResponse> {
  const res = await apiFetch(buildSchemaDiffRequest(search))
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ??
        `Request failed (${res.status} ${res.statusText})`
    )
  }
  return res.json()
}

export function SchemaDiffPage() {
  const hostId = useHostId()
  const navigate = useNavigate()
  const search = useSearch({ from: '/(dashboard)/schema-diff' })

  const sourceParam = Number.isFinite(search.source) ? search.source : undefined
  const targetParam = Number.isFinite(search.target) ? search.target : undefined
  const scopeParam = search.scope

  const { data, isLoading, error } = useQuery({
    queryKey: ['schema-diff', hostId, sourceParam, targetParam, scopeParam],
    queryFn: () =>
      fetchSchemaDiff({
        host: search.host ?? hostId,
        source: sourceParam,
        target: targetParam,
        scope: scopeParam,
      }),
    staleTime: 60_000,
  })

  const [exampleSource, setExampleSource] = useState(0)
  const [exampleTarget, setExampleTarget] = useState(1)
  const example = useMemo(() => buildExampleSchemaDiff(), [])

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

  if (isLoading) {
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
        <ExamplePreviewChrome>
          <SchemaDiffView
            data={example}
            sourceId={exampleSource}
            targetId={exampleTarget}
            scope="hosts"
            peers={example.hosts}
            hostCount={2}
            nodeCount={0}
            onPairChange={(source, target) => {
              setExampleSource(source)
              setExampleTarget(target)
            }}
            example
          />
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
  if (!pair) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Schema Compare" description={PAGE_DESCRIPTION} />
        <ExamplePreviewChrome>
          <SchemaDiffView
            data={example}
            sourceId={exampleSource}
            targetId={exampleTarget}
            scope="hosts"
            peers={example.hosts}
            hostCount={2}
            nodeCount={0}
            onPairChange={(source, target) => {
              setExampleSource(source)
              setExampleTarget(target)
            }}
            example
          />
        </ExamplePreviewChrome>
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
