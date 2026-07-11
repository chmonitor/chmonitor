import { createFileRoute } from '@tanstack/react-router'

import type {
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorListItem,
  PeerListItem,
} from '@/lib/peerdb/types'

import { useMemo } from 'react'
import { DbLogo, hasDbLogo } from '@/components/icons/peerdb-logo'
import { PeerGraph } from '@/components/peerdb/peer-graph'
import { PeerTypeIcon } from '@/components/peerdb/peer-type-icon'
import { PeerDBConnectionStatus } from '@/components/peerdb/peerdb-connection-status'
import { PeerDBNotConfigured } from '@/components/peerdb/peerdb-not-configured'
import {
  dbTypeLabel,
  isPeerDBNotConfigured,
  normalizeDbType,
  peerKind,
  statusTone,
  TONE_COLOR,
} from '@/components/peerdb/peerdb-utils'
import { SlotHealthTable } from '@/components/peerdb/slot-health-table'
import { AppLink } from '@/components/ui/app-link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePeerDB } from '@/lib/swr'

export const Route = createFileRoute('/(peerdb)/peerdb/peers')({
  component: PeerDBPeersPage,
})

/** Per-peer aggregate derived from the mirrors list. */
interface PeerStats {
  /** Number of mirrors where this peer is the source. */
  sourceCount: number
  /** Number of mirrors where this peer is the destination. */
  destCount: number
  /** Worst mirror status tone among mirrors touching this peer. */
  worstTone: string | null
  /** Mirror counts by status tone. */
  toneCounts: Record<string, number>
}

function computePeerStats(
  peerName: string,
  mirrors: MirrorListItem[]
): PeerStats {
  const sourceCount = mirrors.filter((m) => m.sourceName === peerName).length
  const destCount = mirrors.filter((m) => m.destinationName === peerName).length
  const toneCounts: Record<string, number> = {}
  for (const m of mirrors) {
    if (m.sourceName !== peerName && m.destinationName !== peerName) continue
    const t = statusTone(m.status)
    toneCounts[t] = (toneCounts[t] ?? 0) + 1
  }
  const priority = ['failed', 'paused', 'progress', 'running', 'idle']
  let worstTone: string | null = null
  for (const t of priority) {
    if (toneCounts[t]) {
      worstTone = t
      break
    }
  }
  return { sourceCount, destCount, worstTone, toneCounts }
}

/** A single tone dot used in the status summary. */
function ToneDot({ tone, count }: { tone: string; count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px]"
      title={`${count} ${tone}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{
          background: TONE_COLOR[tone as keyof typeof TONE_COLOR] ?? '#94a3b8',
        }}
      />
      <span className="tabular-nums text-muted-foreground">{count}</span>
    </span>
  )
}

function PeerDBPeersPage() {
  const peersReq = usePeerDB<ListPeersResponse>('/peers/list', {
    refreshInterval: 60_000,
  })
  const mirrorsReq = usePeerDB<ListMirrorsResponse>('/mirrors/list', {
    refreshInterval: 60_000,
  })

  // Merge + dedupe peers from all list buckets.
  const peers = useMemo(() => {
    const seen = new Map<string, PeerListItem>()
    for (const p of [
      ...(peersReq.data?.items ?? []),
      ...(peersReq.data?.sourceItems ?? []),
      ...(peersReq.data?.destinationItems ?? []),
    ]) {
      if (p?.name && !seen.has(p.name)) seen.set(p.name, p)
    }
    return Array.from(seen.values())
  }, [peersReq.data])

  const mirrors = mirrorsReq.data?.mirrors ?? []

  // Pre-compute per-peer stats from the mirrors list.
  const statsMap = useMemo(() => {
    const m = new Map<string, PeerStats>()
    for (const p of peers) {
      m.set(p.name, computePeerStats(p.name, mirrors))
    }
    return m
  }, [peers, mirrors])

  if (isPeerDBNotConfigured(peersReq.error)) {
    return <PeerDBNotConfigured />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">PeerDB Peers</h1>
          <p className="text-sm text-muted-foreground">
            Source and destination peers and the mirrors that connect them.
          </p>
        </div>
        <PeerDBConnectionStatus />
      </div>

      <PeerGraph peers={peers} mirrors={mirrors} className="h-[460px]" />

      <SlotHealthTable peers={peers} />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Peer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-center">Source</TableHead>
              <TableHead className="text-center">Destination</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {peers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {peersReq.isLoading ? 'Loading peers…' : 'No peers found.'}
                </TableCell>
              </TableRow>
            ) : (
              peers.map((p) => {
                const stats = statsMap.get(p.name)
                const normalizedType = normalizeDbType(p.type)
                const hasLogo = hasDbLogo(normalizedType)
                return (
                  <TableRow key={p.name}>
                    {/* Peer name + logo */}
                    <TableCell>
                      <AppLink
                        href={`/peerdb/peer?name=${encodeURIComponent(p.name)}`}
                        className="inline-flex items-center gap-2.5 font-medium text-primary hover:underline"
                      >
                        {hasLogo ? (
                          <DbLogo
                            type={normalizedType}
                            width={22}
                            height={22}
                          />
                        ) : (
                          <PeerTypeIcon type={p.type} className="size-[22px]" />
                        )}
                        {p.name}
                      </AppLink>
                    </TableCell>

                    {/* Type with brand-colored dot */}
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span
                          className="inline-flex size-2 shrink-0 rounded-full"
                          style={{
                            background: peerKind(normalizedType).dot,
                          }}
                        />
                        {dbTypeLabel(p.type)}
                      </span>
                    </TableCell>

                    {/* Source mirrors count */}
                    <TableCell className="text-center tabular-nums text-sm">
                      {stats?.sourceCount ? (
                        <span className="font-medium">{stats.sourceCount}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Destination mirrors count */}
                    <TableCell className="text-center tabular-nums text-sm">
                      {stats?.destCount ? (
                        <span className="font-medium">{stats.destCount}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Mirror health summary */}
                    <TableCell>
                      {stats && stats.sourceCount + stats.destCount > 0 ? (
                        <div className="flex items-center gap-2">
                          {(
                            [
                              'running',
                              'progress',
                              'failed',
                              'paused',
                              'idle',
                            ] as const
                          )
                            .filter((t) => stats.toneCounts[t])
                            .map((t) => (
                              <ToneDot
                                key={t}
                                tone={t}
                                count={stats.toneCounts[t]}
                              />
                            ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          No mirrors
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
