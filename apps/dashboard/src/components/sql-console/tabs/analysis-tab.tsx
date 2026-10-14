import { Database, Layers, ListTree, Zap } from 'lucide-react'

import { useExplain } from '../hooks/use-explain'
import { useQueryLog } from '../hooks/use-query-log'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/utils'

interface IndexUsage {
  kind: string
  name?: string
  condition?: string
  parts?: string
  granules?: string
}

interface ExplainAnalysis {
  tables: string[]
  indexes: IndexUsage[]
  projections: string[]
}

/**
 * Parse `EXPLAIN indexes = 1` text output into structured index/projection
 * usage. The output is an indented tree; we scan line-by-line for the
 * ReadFromMergeTree source, the Indexes block (PrimaryKey / Skip), and any
 * Projection entries. Parsing is best-effort and tolerant of version drift.
 */
function parseExplain(lines: string[]): ExplainAnalysis {
  const tables: string[] = []
  const indexes: IndexUsage[] = []
  const projections: string[] = []
  let current: IndexUsage | null = null
  let inIndexes = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    const t = line.trim()

    const read = t.match(/ReadFromMergeTree\s*\(([^)]+)\)/)
    if (read) tables.push(read[1].trim())

    if (/^Indexes:/.test(t)) {
      inIndexes = true
      continue
    }

    if (inIndexes) {
      const idxType = t.match(/^(PrimaryKey|MinMax|Partition|Skip)\b/)
      if (idxType) {
        if (current) indexes.push(current)
        current = { kind: idxType[1] }
        continue
      }
      if (current) {
        const name = t.match(/^Name:\s*(.+)$/)
        if (name) current.name = name[1].trim()
        const cond = t.match(/^Condition:\s*(.+)$/)
        if (cond) current.condition = cond[1].trim()
        const parts = t.match(/^Parts:\s*(.+)$/)
        if (parts) current.parts = parts[1].trim()
        const gran = t.match(/^Granules:\s*(.+)$/)
        if (gran) current.granules = gran[1].trim()
      }
      if (t && !/^\s/.test(line) && !idxType && !/:/.test(t)) {
        inIndexes = false
        if (current) {
          indexes.push(current)
          current = null
        }
      }
    }

    const proj = t.match(/Projection\s*\(([^)]+)\)/)
    if (proj) projections.push(proj[1].trim())
  }
  if (current) indexes.push(current)

  return {
    tables: [...new Set(tables)],
    indexes,
    projections: [...new Set(projections)],
  }
}

function fmtNum(n: unknown): string {
  const v = Number(n)
  return Number.isFinite(v) ? v.toLocaleString() : '—'
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Zap
  label: string
  value: React.ReactNode
  sub?: string
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs uppercase tracking-wide">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 font-mono text-lg tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
    </div>
  )
}

export function AnalysisTab({
  hostId,
  sql,
  queryId,
  active,
}: {
  hostId: number
  sql: string | null
  queryId: string | null
  active: boolean
}) {
  const explain = useExplain(hostId, sql, active)
  const log = useQueryLog(hostId, queryId, active)

  if (!sql) {
    return (
      <div className="text-muted-foreground p-8 text-center text-sm">
        Run a query to analyze its scans, indexes and projections.
      </div>
    )
  }

  if (explain.isFetching && !explain.data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const analysis = parseExplain(explain.data ?? [])
  const profile = (log.data?.ProfileEvents ?? {}) as Record<string, number>
  const tables =
    analysis.tables.length > 0
      ? analysis.tables
      : ((log.data?.tables as string[] | undefined) ?? [])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          icon={Zap}
          label="Rows read"
          value={fmtNum(log.data?.read_rows)}
          sub={log.data ? undefined : 'awaiting query_log…'}
        />
        <MetricCard
          icon={Database}
          label="Bytes read"
          value={formatBytes(Number(log.data?.read_bytes))}
        />
        <MetricCard
          icon={Layers}
          label="Parts selected"
          value={fmtNum(profile.SelectedParts)}
          sub={`${fmtNum(profile.SelectedRanges)} ranges`}
        />
        <MetricCard
          icon={ListTree}
          label="Granules"
          value={fmtNum(profile.SelectedMarks)}
          sub="marks scanned"
        />
      </div>

      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">Tables scanned</h3>
        {tables.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tables.map((t) => (
              <Badge key={t} variant="secondary" className="font-mono text-xs">
                {t}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No table source detected.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Index usage</h3>
        {analysis.indexes.length > 0 ? (
          <div className="space-y-2">
            {analysis.indexes.map((idx, i) => (
              <div key={i} className="rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge className="font-mono text-xs">{idx.kind}</Badge>
                  {idx.name && (
                    <span className="font-mono text-xs">{idx.name}</span>
                  )}
                  {idx.parts && (
                    <span className="text-muted-foreground text-xs">
                      parts {idx.parts}
                    </span>
                  )}
                  {idx.granules && (
                    <span className="text-muted-foreground text-xs">
                      granules {idx.granules}
                    </span>
                  )}
                </div>
                {idx.condition && (
                  <pre className="text-muted-foreground mt-1.5 overflow-x-auto text-xs">
                    {idx.condition}
                  </pre>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No index usage reported — this query likely performs a full scan.
            Consider filtering on primary-key columns.
          </p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold">Projections used</h3>
        {analysis.projections.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {analysis.projections.map((p) => (
              <Badge key={p} className="font-mono text-xs">
                {p}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No projection used for this query.
          </p>
        )}
      </section>
    </div>
  )
}
