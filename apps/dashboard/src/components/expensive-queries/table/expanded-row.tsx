import { Code2, ExternalLink } from 'lucide-react'

import { type DerivedQuery, num } from './types'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { DialogSQL } from '@/components/dialogs/dialog-sql'
import { DetailField } from '@/components/query-tables/detail-field'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import {
  formatCompactNumber,
  formatReadableSecondDuration,
} from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'

/**
 * Expanded panel — the full secondary-metric grid, the full query as a
 * scrollable code block, then row actions (full-query dialog + explorer).
 */
export function ExpandedRow({ d }: { d: DerivedQuery }) {
  const hostId = useHostId()
  const explorerUrl = buildExplorerQueryUrl(d.query, hostId)
  const lineCount = (d.query.match(/\n/g)?.length ?? 0) + 1

  // Every field is backed by a real column the config selects.
  const fields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: 'Runs', value: formatCompactNumber(d.cnt) },
    {
      label: 'Total time',
      value: formatReadableSecondDuration(Math.round(d.queriesDuration)),
      mono: false,
    },
    {
      label: 'User CPU',
      value: formatReadableSecondDuration(Math.round(d.userTime)),
      mono: false,
    },
    {
      label: 'System CPU',
      value: formatReadableSecondDuration(Math.round(d.systemTime)),
      mono: false,
    },
    {
      label: 'Real time',
      value: formatReadableSecondDuration(Math.round(d.realTime)),
      mono: false,
    },
    { label: 'Memory (q97)', value: d.readableMemory },
    { label: 'Rows read', value: formatCompactNumber(d.readRows) },
    { label: 'Rows written', value: formatCompactNumber(d.writtenRows) },
    { label: 'Result rows', value: formatCompactNumber(d.resultRows) },
    { label: 'Selected rows', value: formatCompactNumber(d.selectedRows) },
    { label: 'Bytes read', value: d.readBytes },
    { label: 'Bytes written', value: d.writtenBytes },
    { label: 'Result bytes', value: d.resultBytes },
    {
      label: 'Disk read',
      value: formatReadableSecondDuration(
        Math.round(num(d.row.disk_read_time))
      ),
      mono: false,
    },
    {
      label: 'Net receive',
      value: String(d.row.network_receive_bytes ?? '—'),
    },
    {
      label: 'Cache',
      value: d.cacheUsage ?? '—',
      mono: false,
    },
  ]

  return (
    <div className="space-y-3 border-t border-border bg-muted/40 px-3 py-3.5 sm:px-5">
      {/* Secondary metrics — a compact key/value grid */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Aggregated metrics (last 24h)
        </div>
        <dl className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => (
            <DetailField
              key={f.label}
              label={f.label}
              value={f.value}
              mono={f.mono}
            />
          ))}
        </dl>
      </div>

      {/* Full query — a plain, scrollable code block. */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Query fingerprint
          </span>
          <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
            {d.query.length.toLocaleString()} chars
            <span className="mx-1.5 opacity-50">·</span>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <CodeBlock
          code={d.query}
          language="sql"
          showLineNumbers={lineCount > 1}
          className="max-h-[180px]"
        >
          <CodeBlockCopyButton className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity bg-background border border-border" />
        </CodeBlock>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <DialogSQL
          sql={d.query}
          title={`#${d.rank} · Most expensive query`}
          description="Full normalized query fingerprint"
          defaultBeautify
          button={
            <Button variant="outline" size="sm" className="h-7 gap-1.5">
              <Code2 className="size-3.5" />
              Full query
            </Button>
          }
        />
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          render={<Link href={explorerUrl} />}
        >
          <ExternalLink className="size-3.5" />
          Open in Explorer
        </Button>
      </div>
    </div>
  )
}
