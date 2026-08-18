/**
 * Schema Compare
 * Route: /(dashboard)/schema-diff
 *
 * Read-only table-schema compare + recommend-only change plan.
 * Copy statements only — never apply DDL.
 */

import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { CopyIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { pageOgHead } from '@/lib/og'
import type { PlanItem, SchemaDiffResult, TableDiff } from '@/lib/schema-diff'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'
import { copyToClipboard } from '@/lib/utils/clipboard'

type HostInfo = { id: number; name: string }

type SchemaDiffResponse = {
  success: boolean
  hosts: HostInfo[]
  sourceHostId: number | null
  targetHostId: number | null
  diff: SchemaDiffResult
  plan: { items: PlanItem[]; safeStatements: string[] }
  error?: string
  unavailable?: { reason: string; message: string }
}

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

function riskLabel(risk: PlanItem['risk']): string {
  if (risk === 'lightweight') return 'Lightweight'
  if (risk === 'mutation') return 'Mutation'
  return 'Manual rewrite'
}

function SchemaDiffPage() {
  const hostId = useHostId()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    host?: number
    source?: number
    target?: number
  }

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Source</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
            value={sourceHostId}
            onChange={(e) => {
              const next = Number(e.target.value)
              const nextTarget = next === targetHostId ? sourceHostId : targetHostId
              setPair(next, nextTarget)
            }}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">Target</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-[13px]"
            value={targetHostId}
            onChange={(e) => {
              const next = Number(e.target.value)
              const nextSource = next === sourceHostId ? targetHostId : sourceHostId
              setPair(nextSource, next)
            }}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <Input
          placeholder="Filter tables…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="h-8 w-full sm:w-64"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={showDiffsOnly} onCheckedChange={setShowDiffsOnly} />
          Differences only
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="rounded-xl border bg-card shadow-sm">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.length === 0 ? (
                <li className="p-4">
                  <EmptyState
                    variant="filtered-empty"
                    compact
                    title="No tables match"
                    description="Try a different filter or turn off differences only."
                  />
                </li>
              ) : (
                rows.map((row) => (
                  <li key={row.key}>
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted ${
                        selected?.key === row.key ? 'bg-muted' : ''
                      }`}
                      onClick={() => setSelectedKey(row.key)}
                    >
                      <span className="font-mono truncate">{row.key}</span>
                      <Badge variant="outline" className="shrink-0 text-muted-foreground">
                        {row.kind === 'only_source'
                          ? 'source only'
                          : row.kind === 'only_target'
                            ? 'target only'
                            : row.kind === 'changed'
                              ? 'changed'
                              : 'same'}
                      </Badge>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {selected ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Card className="rounded-xl border bg-card shadow-sm">
                  <CardContent className="p-4">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Source DDL
                    </p>
                    {selected.source?.createTableQuery ? (
                      <CodeBlock
                        code={selected.source.createTableQuery}
                        language="sql"
                      >
                        <CodeBlockCopyButton />
                      </CodeBlock>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not on source
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-xl border bg-card shadow-sm">
                  <CardContent className="p-4">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Target DDL
                    </p>
                    {selected.target?.createTableQuery ? (
                      <CodeBlock
                        code={selected.target.createTableQuery}
                        language="sql"
                      >
                        <CodeBlockCopyButton />
                      </CodeBlock>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Not on target
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-xl border bg-card shadow-sm">
                <CardContent className="p-4">
                  <h2 className="mb-3 text-sm font-medium text-foreground">
                    Recommended change plan
                  </h2>
                  {selectedPlan.length === 0 ? (
                    <EmptyState
                      variant="no-data"
                      compact
                      title="No recommended statements"
                      description="This table matches, or every delta is a manual rewrite."
                    />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {selectedPlan.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border border-border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm">{item.summary}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {riskLabel(item.risk)}
                                {item.safe ? ' · safe to copy' : ''}
                              </p>
                            </div>
                            {item.statement ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 shrink-0"
                                onClick={() => copyToClipboard(item.statement)}
                              >
                                <CopyIcon className="size-3.5" strokeWidth={1.5} />
                                Copy
                              </Button>
                            ) : null}
                          </div>
                          {item.statement ? (
                            <pre className="mt-2 overflow-x-auto font-mono text-xs text-muted-foreground">
                              {item.statement}
                            </pre>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
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

export const Route = createFileRoute('/(dashboard)/schema-diff')({
  component: SchemaDiffPage,
  head: () => pageOgHead('schema-diff'),
  validateSearch: (search: Record<string, unknown>) => search,
})
