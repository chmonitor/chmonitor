import type { CDCBatch } from '@/lib/peerdb/types'

import { PdbBarChart } from './pdb-charts'
import { batchDurationSec } from './peerdb-derive'
import {
  pdbFmtClock,
  pdbFmtDuration,
  pdbFmtNum,
  toNumber,
} from './peerdb-utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * Recent CDC batch history — one row per batch (id, LSN range, rows, duration)
 * plus a rows-per-batch bar chart. Presentational: the batches array is fetched
 * once by the parent (`POST /v1/mirrors/cdc/batches`) and shared, never fetched
 * twice.
 */
export function CdcBatchHistory({ batches }: { batches: CDCBatch[] }) {
  if (batches.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No CDC batches recorded for this mirror yet.
      </p>
    )
  }

  // Oldest→newest for the chart so time reads left→right.
  const chrono = [...batches].sort(
    (a, b) => toNumber(a.batchId) - toNumber(b.batchId)
  )
  const chartData = chrono.map((b) => ({
    x: pdbFmtClock(b.endTime ?? b.startTime),
    y: toNumber(b.numRows),
  }))

  // Table shows newest first.
  const rows = [...batches].sort(
    (a, b) => toNumber(b.batchId) - toNumber(a.batchId)
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-card p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rows per batch
          </span>
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {batches.length} batches
          </span>
        </div>
        <PdbBarChart
          data={chartData}
          color="#3b82f6"
          height={180}
          valueFormatter={pdbFmtNum}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead>LSN range</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Ended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b, i) => {
              const dur = batchDurationSec(b)
              return (
                <TableRow key={b.batchId ?? i}>
                  <TableCell className="font-mono text-xs tabular-nums">
                    #{String(b.batchId ?? '—')}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {b.startLsn ?? '—'} → {b.endLsn ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pdbFmtNum(toNumber(b.numRows))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {dur === null ? '—' : pdbFmtDuration(dur)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {pdbFmtClock(b.endTime ?? b.startTime)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
