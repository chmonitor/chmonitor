import type { CDCTableRowCounts } from '@/lib/peerdb/types'

import { pdbFmtNum, toNumber } from './peerdb-utils'

const OPS = [
  { key: 'insertsCount', label: 'Inserts', color: '#10b981' },
  { key: 'updatesCount', label: 'Updates', color: '#3b82f6' },
  { key: 'deletesCount', label: 'Deletes', color: '#f43f5e' },
] as const

/**
 * Per-table insert/update/delete operation mix as stacked horizontal bars,
 * hand-rolled in the Pdb* CSS-bar style (no recharts). Data comes from
 * `GET /v1/mirrors/cdc/table_total_counts/{flow}`, already fetched by the page.
 */
export function OperationMixChart({ tables }: { tables: CDCTableRowCounts[] }) {
  const rows = tables
    .map((t) => {
      const inserts = toNumber(t.counts?.insertsCount)
      const updates = toNumber(t.counts?.updatesCount)
      const deletes = toNumber(t.counts?.deletesCount)
      return {
        name: t.tableName ?? '—',
        inserts,
        updates,
        deletes,
        total: inserts + updates + deletes,
      }
    })
    .filter((r) => r.total > 0)

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No operation counts available.
      </p>
    )
  }

  const max = Math.max(...rows.map((r) => r.total), 1)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5">
      {/* legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
        {OPS.map((op) => (
          <span key={op.key} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-sm"
              style={{ background: op.color }}
            />
            {op.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.name} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[11.5px] font-medium">
                {r.name}
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {pdbFmtNum(r.total)}
              </span>
            </div>
            <div
              className="flex h-3 overflow-hidden rounded-sm bg-muted"
              style={{ width: `${(r.total / max) * 100}%`, minWidth: '2px' }}
              title={`${r.name}: ${pdbFmtNum(r.inserts)} ins · ${pdbFmtNum(
                r.updates
              )} upd · ${pdbFmtNum(r.deletes)} del`}
            >
              {OPS.map((op) => {
                const v =
                  r[
                    op.key === 'insertsCount'
                      ? 'inserts'
                      : op.key === 'updatesCount'
                        ? 'updates'
                        : 'deletes'
                  ]
                const pct = r.total ? (v / r.total) * 100 : 0
                if (pct <= 0) return null
                return (
                  <div
                    key={op.key}
                    className="h-full"
                    style={{ width: `${pct}%`, background: op.color }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
