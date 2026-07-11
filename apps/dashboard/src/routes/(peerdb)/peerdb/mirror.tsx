import { createFileRoute, useSearch } from '@tanstack/react-router'

import type {
  CDCTableTotalCountsResponse,
  GetCDCBatchesResponse,
  GraphResponse,
  ListMirrorLogsResponse,
  MirrorStatusResponse,
  TotalRowsSyncedResponse,
} from '@/lib/peerdb/types'

import { Suspense } from 'react'
import { CdcBatchHistory } from '@/components/peerdb/cdc-batch-history'
import { MirrorStatusBadge } from '@/components/peerdb/mirror-status-badge'
import { OperationMixChart } from '@/components/peerdb/operation-mix-chart'
import { PartitionTable } from '@/components/peerdb/partition-table'
import { PeerDBNotConfigured } from '@/components/peerdb/peerdb-not-configured'
import {
  formatDateTime,
  isPeerDBNotConfigured,
  toNumber,
} from '@/components/peerdb/peerdb-utils'
import { RowsSyncedChart } from '@/components/peerdb/rows-synced-chart'
import { SnapshotProgress } from '@/components/peerdb/snapshot-progress'
import { AppLink } from '@/components/ui/app-link'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatReadableQuantity } from '@/lib/format-readable'
import { usePeerDB } from '@/lib/swr'

export const Route = createFileRoute('/(peerdb)/peerdb/mirror')({
  component: PeerDBMirrorDetailPage,
})

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  )
}

function MirrorDetailContent() {
  const search = useSearch({ strict: false }) as { name?: string }
  const name = search.name ?? ''
  const enabled = Boolean(name)

  const status = usePeerDB<MirrorStatusResponse>(
    enabled ? '/mirrors/status' : null,
    {
      body: { flowJobName: name, includeFlowInfo: true },
      refreshInterval: 30_000,
    }
  )
  const graph = usePeerDB<GraphResponse>(
    enabled ? '/mirrors/cdc/graph' : null,
    {
      body: { flowJobName: name, aggregateType: '1hour' },
      refreshInterval: 60_000,
    }
  )
  const tableCounts = usePeerDB<CDCTableTotalCountsResponse>(
    enabled
      ? `/mirrors/cdc/table_total_counts/${encodeURIComponent(name)}`
      : null
  )
  const logs = usePeerDB<ListMirrorLogsResponse>(
    enabled ? '/mirrors/logs' : null,
    { body: { flowJobName: name, level: 'error', page: 0, numPerPage: 20 } }
  )
  // Authoritative cumulative rows synced (GET /v1/mirrors/total_rows_synced).
  const totalSynced = usePeerDB<TotalRowsSyncedResponse>(
    enabled ? `/mirrors/total_rows_synced/${encodeURIComponent(name)}` : null,
    { refreshInterval: 60_000 }
  )
  // Recent CDC batches — fetched once here and shared with the batch history.
  const batchesReq = usePeerDB<GetCDCBatchesResponse>(
    enabled ? '/mirrors/cdc/batches' : null,
    {
      body: { flowJobName: name, page: 0, numPerPage: 20 },
      refreshInterval: 30_000,
    }
  )

  if (isPeerDBNotConfigured(status.error)) {
    return <PeerDBNotConfigured />
  }

  if (!name) {
    return <p className="text-sm text-muted-foreground">No mirror selected.</p>
  }

  const data = status.data
  const cdc = data?.cdcStatus
  const qrep = data?.qrepStatus
  const isCdc = !qrep
  const partitions = qrep?.partitions ?? []
  const tables = tableCounts.data?.tablesData ?? []
  const errors = logs.data?.errors ?? []
  const batches = batchesReq.data?.cdcBatches ?? cdc?.cdcBatches ?? []
  // Prefer the authoritative total_rows_synced endpoint; fall back to the CDC
  // status counter (older PeerDB / not-yet-loaded).
  const authoritativeTotal =
    totalSynced.data?.totalCount ?? totalSynced.data?.totalRowsSynced
  const rowsSynced =
    authoritativeTotal != null
      ? toNumber(authoritativeTotal)
      : toNumber(cdc?.rowsSynced)
  const hasRowsSynced = authoritativeTotal != null || cdc?.rowsSynced != null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <AppLink
          href="/peerdb"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Mirrors
        </AppLink>
        <h1 className="text-2xl font-semibold">{name}</h1>
        <MirrorStatusBadge status={data?.currentFlowState} />
        <span className="text-xs text-muted-foreground">
          {qrep ? 'Query Replication' : 'CDC'}
        </span>
      </div>

      {data?.errorMessage ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {data.errorMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Rows synced (total)"
          value={hasRowsSynced ? formatReadableQuantity(rowsSynced) : '—'}
        />
        <StatCard
          label="Tables"
          value={String(tables.length || partitions.length || 0)}
        />
        <StatCard
          label="Total (graph)"
          value={
            graph.data
              ? formatReadableQuantity(toNumber(graph.data.totalRows))
              : '—'
          }
        />
      </div>

      <SnapshotProgress flowJobName={name} status={data?.currentFlowState} />

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Rows synced over time</h2>
        <RowsSyncedChart data={graph.data?.data ?? []} />
      </section>

      {isCdc && batches.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">CDC batch history</h2>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              POST /v1/mirrors/cdc/batches
            </span>
          </div>
          <CdcBatchHistory batches={batches} />
        </section>
      ) : null}

      {partitions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Partitions</h2>
          <PartitionTable partitions={partitions} />
        </section>
      ) : null}

      {tables.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Per-table operation mix</h2>
          <OperationMixChart tables={tables} />
        </section>
      ) : null}

      {tables.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Per-table stats</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead className="text-right">Inserts</TableHead>
                  <TableHead className="text-right">Updates</TableHead>
                  <TableHead className="text-right">Deletes</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((t) => (
                  <TableRow key={t.tableName}>
                    <TableCell className="font-mono text-xs">
                      {t.tableName}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatReadableQuantity(toNumber(t.counts?.insertsCount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatReadableQuantity(toNumber(t.counts?.updatesCount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatReadableQuantity(toNumber(t.counts?.deletesCount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatReadableQuantity(toNumber(t.counts?.totalCount))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Recent errors</h2>
          <div className="flex flex-col gap-2">
            {errors.map((e, i) => (
              <div
                key={e.id ?? i}
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-destructive">
                    {e.errorType ?? 'error'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.errorTimestamp)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {e.errorMessage}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function PeerDBMirrorDetailPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm">Loading…</div>}>
      <MirrorDetailContent />
    </Suspense>
  )
}
