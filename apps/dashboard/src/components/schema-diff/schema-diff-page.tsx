import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { CopyIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { SchemaDiffResponse, TableDiff } from '@/lib/schema-diff'

import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'
import { copyToClipboard } from '@/lib/utils/clipboard'

import { DdlPair } from './ddl-pair'
import { HostPairFilter } from './host-pair-filter'
import { PlanList } from './plan-list'
import { TableList } from './table-list'

async function fetchSchemaDiff(
  source?: number,
  target?: number
): Promise<SchemaDiffResponse> {
  const params = new URLSearchParams()
  if (source !== undefined) params.set('source', String(source))
  if (target !== undefined) params.set('target', String(target))
  const qs = params.toString()
  const res = await apiFetch(`/api/v1/schema-diff${qs ? `?${qs}` : ''}`)
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

  const [showDiffsOnly, setShowDiffsOnly] = useState(true)
  const [nameFilter, setNameFilter] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [copiedSafe, setCopiedSafe] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['schema-diff', sourceParam, targetParam],
    queryFn: () => fetchSchemaDiff(sourceParam, targetParam),
    staleTime: 60_000,
  })

  const hosts = data?.hosts ?? []

  const setPair = (source: number, target: number) => {
    navigate({
      href: buildUrl(
        '/schema-diff',
        { host: search.host ?? hostId, source, target },
        undefined
      ),
      replace: true,
    })
  }

  const rows: TableDiff[] = useMemo(() => {
    if (!data?.diff) return []
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
  const selectedPlan = (data?.plan.items ?? []).filter(
    (item) => item.tableKey === selected?.key
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Schema Compare"
          description="Compare table schemas across hosts. Recommend only — copy statements, never apply."
        />
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
        <PageHeader
          title="Schema Compare"
          description="Compare table schemas across hosts. Recommend only — copy statements, never apply."
        />
        <EmptyState variant="error" title="Failed to load schema diff" description={message} />
      </div>
    )
  }

  if (hosts.length < 2) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Schema Compare"
          description="Compare table schemas across hosts. Recommend only — copy statements, never apply."
        />
        <EmptyState
          variant="no-data"
          title="Need at least two hosts"
          description={
            data.unavailable?.message ??
            'Schema compare needs two configured ClickHouse hosts (for example staging and production).'
          }
        />
      </div>
    )
  }

  const sourceHostId = data.sourceHostId ?? hosts[0].id
  const targetHostId = data.targetHostId ?? hosts[1].id
  const sourceHost = hosts.find((h) => h.id === sourceHostId)
  const targetHost = hosts.find((h) => h.id === targetHostId)
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
      <PageHeader
        title="Schema Compare"
        description={`Comparing ${sourceHost?.name ?? sourceHostId} → ${targetHost?.name ?? targetHostId} — ${diffCount} table${diffCount !== 1 ? 's' : ''} differ. Recommend only; copy statements, never apply.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={copySafe}
            disabled={data.plan.safeStatements.length === 0}
          >
            <CopyIcon className="mr-2 size-3.5" strokeWidth={1.5} />
            {copiedSafe ? 'Copied' : 'Copy safe statements'}
          </Button>
        }
      />

      <HostPairFilter
        hosts={hosts}
        sourceHostId={sourceHostId}
        targetHostId={targetHostId}
        nameFilter={nameFilter}
        showDiffsOnly={showDiffsOnly}
        onPairChange={setPair}
        onNameFilterChange={setNameFilter}
        onShowDiffsOnlyChange={setShowDiffsOnly}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <TableList
          rows={rows}
          selectedKey={selected?.key ?? null}
          onSelect={setSelectedKey}
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
