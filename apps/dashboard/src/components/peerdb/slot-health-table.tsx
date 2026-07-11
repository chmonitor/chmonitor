import type {
  PeerListItem,
  PeerSlotResponse,
  SlotInfo,
} from '@/lib/peerdb/types'

import { type SlotHealth, slotHealth } from './peerdb-derive'
import { normalizeDbType, pdbFmtBytes } from './peerdb-utils'
import { useCallback, useEffect, useState } from 'react'
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

const HEALTH_META: Record<
  SlotHealth,
  { label: string; dot: string; text: string }
> = {
  ok: {
    label: 'OK',
    dot: '#10b981',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  warn: {
    label: 'WARN',
    dot: '#f59e0b',
    text: 'text-amber-700 dark:text-amber-400',
  },
  critical: {
    label: 'CRITICAL',
    dot: '#f43f5e',
    text: 'text-rose-600 dark:text-rose-400',
  },
}

interface SlotRow extends SlotInfo {
  peer: string
}

/** Hidden per-peer slot fetcher (GET /v1/peers/slots/{peer}). */
function SlotSource({
  peer,
  onSlots,
}: {
  peer: string
  onSlots: (peer: string, slots: SlotInfo[]) => void
}) {
  const { data } = usePeerDB<PeerSlotResponse>(
    `/peers/slots/${encodeURIComponent(peer)}`,
    { refreshInterval: 30_000 }
  )
  const slots = data?.slotData
  const key = slots?.length ?? -1
  // biome-ignore lint/correctness/useExhaustiveDependencies: slots tracked via key
  useEffect(() => {
    if (slots) onSlots(peer, slots)
  }, [peer, key, onSlots])
  return null
}

/**
 * Fleet-wide replication-slot health across all Postgres peers. Aggregates
 * `GET /v1/peers/slots/{peer}`, classifies each slot (ok / warn / critical) via
 * `slotHealth`, and surfaces lag, active state, and WAL status with warning
 * tones. Sorted worst-first so risky slots (inactive, unreserved WAL, high lag)
 * rise to the top.
 */
export function SlotHealthTable({ peers }: { peers: PeerListItem[] }) {
  const [byPeer, setByPeer] = useState<Record<string, SlotInfo[]>>({})

  const pgPeers = peers.filter((p) => normalizeDbType(p.type) === 'POSTGRES')

  const onSlots = useCallback((peer: string, slots: SlotInfo[]) => {
    setByPeer((prev) => {
      const cur = prev[peer]
      if (cur && cur.length === slots.length) return prev
      return { ...prev, [peer]: slots }
    })
  }, [])

  if (pgPeers.length === 0) return null

  const rows: SlotRow[] = []
  for (const p of pgPeers) {
    for (const s of byPeer[p.name] ?? []) rows.push({ ...s, peer: p.name })
  }
  const rank: Record<SlotHealth, number> = { critical: 0, warn: 1, ok: 2 }
  rows.sort((a, b) => rank[slotHealth(a)] - rank[slotHealth(b)])

  return (
    <section className="flex flex-col gap-2">
      {pgPeers.map((p) => (
        <SlotSource key={p.name} peer={p.name} onSlots={onSlots} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Replication slot health</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          GET /v1/peers/slots/&lt;peer&gt;
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Health</TableHead>
              <TableHead>Peer</TableHead>
              <TableHead>Slot</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Lag</TableHead>
              <TableHead>WAL status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  No replication slots across Postgres peers.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const health = slotHealth(s)
                const meta = HEALTH_META[health]
                return (
                  <TableRow key={`${s.peer}-${s.slotName}`}>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: meta.dot }}
                        />
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <AppLink
                        href={`/peerdb/peer?name=${encodeURIComponent(s.peer)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.peer}
                      </AppLink>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.slotName ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.active === false ? (
                        <span className="text-rose-600 dark:text-rose-400">
                          inactive
                        </span>
                      ) : (
                        'active'
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-xs tabular-nums ${
                        health !== 'ok' ? meta.text : ''
                      }`}
                    >
                      {pdbFmtBytes(s.lagInMb)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.walStatus ?? '—'}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
