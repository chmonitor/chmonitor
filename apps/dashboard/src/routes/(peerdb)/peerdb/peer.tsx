import { createFileRoute, useSearch } from '@tanstack/react-router'

import type {
  PeerSlotResponse,
  PeerStatResponse,
  SlotLagHistoryResponse,
} from '@/lib/peerdb/types'

import { Suspense } from 'react'
import { MiniAreaChart } from '@/components/charts/mini-charts'
import { PeerDetailSkeleton } from '@/components/peerdb/peer-detail-skeleton'
import { PeerInfoCard } from '@/components/peerdb/peer-info-card'
import { PeerDBNotConfigured } from '@/components/peerdb/peerdb-not-configured'
import {
  isPeerDBNotConfigured,
  toNumber,
} from '@/components/peerdb/peerdb-utils'
import { AppLink } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePeerDB } from '@/lib/swr'

export const Route = createFileRoute('/(peerdb)/peerdb/peer')({
  component: PeerDBPeerDetailPage,
})

function PeerDetailContent() {
  const search = useSearch({ strict: false }) as { name?: string }
  const name = search.name ?? ''
  const enabled = Boolean(name)

  const slots = usePeerDB<PeerSlotResponse>(
    enabled ? `/peers/slots/${encodeURIComponent(name)}` : null,
    { refreshInterval: 30_000 }
  )
  const stats = usePeerDB<PeerStatResponse>(
    enabled ? `/peers/stats/${encodeURIComponent(name)}` : null,
    { refreshInterval: 30_000 }
  )

  const slotData = slots.data?.slotData ?? []
  const primarySlot = slotData[0]?.slotName

  const lag = usePeerDB<SlotLagHistoryResponse>(
    enabled && primarySlot ? '/peers/slots/lag_history' : null,
    {
      body: { peerName: name, slotName: primarySlot, timeSince: '1day' },
    }
  )

  if (isPeerDBNotConfigured(slots.error)) {
    return <PeerDBNotConfigured />
  }

  if (!name) {
    return <p className="text-sm text-muted-foreground">No peer selected.</p>
  }

  const queries = stats.data?.statData ?? []
  const lagPoints = (lag.data?.data ?? []).map((p) => toNumber(p.size))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <AppLink
          href="/peerdb/peers"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Peers
        </AppLink>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Peer info</h2>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            GET /v1/peers/info/&lt;name&gt;
          </span>
        </div>
        <div className="max-w-xl">
          <PeerInfoCard
            name={name}
            peerRole={slotData.length > 0 ? 'source' : 'destination'}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Replication slots</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slot</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Lag (MB)</TableHead>
                <TableHead>WAL status</TableHead>
                <TableHead>Restart LSN</TableHead>
                <TableHead>Confirmed flush LSN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slotData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    {slots.isLoading
                      ? 'Loading slots…'
                      : 'No replication slots (non-Postgres peer or no CDC).'}
                  </TableCell>
                </TableRow>
              ) : (
                slotData.map((s) => (
                  <TableRow key={s.slotName}>
                    <TableCell className="font-mono text-xs">
                      {s.slotName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.active ? 'default' : 'secondary'}>
                        {s.active ? 'active' : 'inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {toNumber(s.lagInMb).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.walStatus ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.restartLSN ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.confirmedFlushLSN ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {lagPoints.length >= 2 ? (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">
            Slot lag (MB) — {primarySlot}
          </h2>
          <div className="h-[160px] w-full">
            <MiniAreaChart
              data={lagPoints}
              label="Lag (MB)"
              color="var(--chart-2, #f59e0b)"
              valueFormatter={(v) => `${v.toFixed(1)} MB`}
            />
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Active queries</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PID</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Wait event</TableHead>
                <TableHead>Query</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    {stats.isLoading ? 'Loading…' : 'No active queries.'}
                  </TableCell>
                </TableRow>
              ) : (
                queries.map((q, i) => (
                  <TableRow key={q.pid ?? i}>
                    <TableCell className="tabular-nums">
                      {q.pid ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">{q.state ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {q.duration ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {q.waitEvent ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs">
                      {q.query}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function PeerDBPeerDetailPage() {
  return (
    <Suspense fallback={<PeerDetailSkeleton />}>
      <PeerDetailContent />
    </Suspense>
  )
}
