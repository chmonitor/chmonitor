'use client'

/**
 * Table-overview wiring for the existing schema/settings tuning API.
 * Recommend-only: Scan is explicit (no first-paint request). Findings render
 * through TuningFindingsPanel — no apply/run control. See issue #3075.
 */

import { SlidersHorizontalIcon, WandSparklesIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useEffect, useMemo, useState } from 'react'
import {
  type TuningFindingsOutput,
  TuningFindingsPanel,
} from '@/components/agents/tuning-findings-panel'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { annotateDdlForTopology } from '@/lib/ddl/on-cluster'
import {
  type ClusterReplicaRow,
  formatDistributedTopologyNote,
  parseDistributedEngine,
} from '@/lib/explorer/engine-kind'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { buildUrl } from '@/lib/url/url-builder'

interface TuningApiResponse extends TuningFindingsOutput {
  success: true
}
interface TuningApiError {
  success: false
  error: string
}

interface TopologyApiResponse {
  success?: boolean
  data?: ClusterReplicaRow[]
}

const fetchTuning = async (url: string): Promise<TuningApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as TuningApiResponse | TuningApiError
  if (!res.ok || !body.success) {
    throw new Error(
      (body as TuningApiError).error || `Scan failed (HTTP ${res.status})`
    )
  }
  return body
}

const fetchTopology = async (url: string): Promise<ClusterReplicaRow[]> => {
  const res = await apiFetch(url)
  if (!res.ok) return []
  const body = (await res.json()) as TopologyApiResponse
  return Array.isArray(body.data) ? body.data : []
}

export function ExplorerTuningSection({
  database,
  table,
  engine,
  engineFull,
}: {
  database: string
  table: string
  engine?: string | null
  engineFull?: string | null
}) {
  const hostId = useHostId()
  const [scanKey, setScanKey] = useState<string | null>(null)
  const tableKey = `${database}.${table}`

  // tableKey is the reset trigger; scanKey itself isn't read here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the table changes
  useEffect(() => {
    setScanKey(null)
  }, [tableKey])

  const dist = useMemo(
    () =>
      engine === 'Distributed' || (engineFull ?? '').includes('Distributed')
        ? parseDistributedEngine(engineFull)
        : null,
    [engine, engineFull]
  )

  const tuningUrl =
    scanKey === tableKey
      ? `/api/v1/advisor/tuning?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null

  const { data, error, isLoading, isFetching } = useQuery<TuningApiResponse>({
    queryKey: [tuningUrl],
    queryFn: () => fetchTuning(tuningUrl as string),
    enabled: Boolean(tuningUrl),
  })

  const topologyUrl =
    scanKey === tableKey && dist
      ? `/api/v1/tables/clusters-topology?hostId=${hostId}`
      : null

  const { data: topologyRows } = useQuery<ClusterReplicaRow[]>({
    queryKey: [topologyUrl],
    queryFn: () => fetchTopology(topologyUrl as string),
    enabled: Boolean(topologyUrl),
  })

  const output = useMemo(() => {
    if (!data) return null
    const notes = [...data.notes]
    if (dist) {
      notes.unshift(formatDistributedTopologyNote(dist, topologyRows))
    }
    const topology = dist
      ? {
          cluster: dist.cluster,
          localDatabase: dist.database,
          localTable: dist.table,
        }
      : null
    const findings = topology
      ? data.findings.map((finding) => {
          if (finding.onClusterStatement) return finding
          const variant = annotateDdlForTopology(finding.ddl, topology)
          return {
            ...finding,
            ddl: variant.statement || finding.ddl,
            localTableName: variant.localTableName,
            onClusterStatement: variant.onClusterStatement,
            localOnlyReason: variant.localOnlyReason,
          }
        })
      : data.findings
    return { ...data, notes, findings }
  }, [data, dist, topologyRows])

  const advisorHref = buildUrl('/advisor', { host: hostId })

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <WandSparklesIcon
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <h2 className="text-sm font-medium text-foreground">Advisor</h2>
        </div>
        <Link
          href={advisorHref}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Analyze a slow query on this table
        </Link>
      </div>

      {tuningUrl === null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-3">
          <p className="text-[13px] text-muted-foreground">
            Scan for copyable schema and settings suggestions. Nothing is
            applied automatically.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScanKey(tableKey)}
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Scan this table
          </Button>
        </div>
      ) : null}

      {isLoading || (isFetching && !data) ? <TableSkeleton rows={3} /> : null}

      {error ? (
        <ErrorAlert
          title="Scan failed"
          message={error instanceof Error ? error.message : String(error)}
        />
      ) : null}

      {!isLoading && !error && output ? (
        output.findings.length === 0 && !dist ? (
          <div className="rounded-lg border bg-card px-3 py-4">
            <EmptyState
              compact
              variant="no-data"
              title="No tuning opportunities"
              description="Columns and settings look well-tuned for this table."
            />
          </div>
        ) : (
          <TuningFindingsPanel output={output} />
        )
      ) : null}
    </section>
  )
}
