import {
  ChevronRight,
  Code2,
  Cpu,
  Database,
  ExternalLink,
  MemoryStick,
  Repeat,
} from 'lucide-react'

import { CpuCell, MemoryCell, RankBadge, TotalTimeCell } from './cells'
import { ExpandedRow } from './expanded-row'
import {
  BASE_COLUMN_COUNT,
  type DerivedQuery,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
} from './types'
import { memo } from 'react'
import { DialogSQL } from '@/components/dialogs/dialog-sql'
import { formatDuration } from '@/components/query-tables/format-duration'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatCompactNumber } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

interface QueryRowProps {
  d: DerivedQuery
  maxDuration: number
  maxCpu: number
  maxMemory: number
  expanded: boolean
  onToggle: () => void
  hiddenColumns: Set<OptionalColumn>
}

/** One fingerprint rendered as a table row (collapsed) + detail row. */
export const QueryRow = memo(function QueryRow({
  d,
  maxDuration,
  maxCpu,
  maxMemory,
  expanded,
  onToggle,
  hiddenColumns,
}: QueryRowProps) {
  const hostId = useHostId()
  const showCnt = !hiddenColumns.has('cnt')
  const showCpu = !hiddenColumns.has('cpu')
  const showMemory = !hiddenColumns.has('memory')
  const showReadRows = !hiddenColumns.has('readRows')
  const colSpan =
    BASE_COLUMN_COUNT + (OPTIONAL_COLUMNS.length - hiddenColumns.size)
  const cpu = formatDuration(d.userTime)

  return (
    <>
      <tr
        className={cn(
          'group animate-in cursor-pointer border-b border-border align-middle fade-in-0 duration-300 hover:bg-muted/60',
          d.severity === 'critical' && 'bg-rose-50/60 dark:bg-rose-950/15',
          d.severity === 'warning' && 'bg-amber-50/60 dark:bg-amber-950/10'
        )}
        onClick={onToggle}
      >
        {/* Rank + expand chevron */}
        <td className="px-2 py-2.5 sm:px-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ChevronRight
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
            <RankBadge rank={d.rank} severity={d.severity} />
          </div>
        </td>

        {/* Query text + meta line (carries hidden-column values on small screens) */}
        <td className="min-w-0 px-2 py-2.5">
          <span
            className="block min-w-0 truncate font-mono text-[11.5px] text-foreground sm:text-[12px]"
            title={d.query}
          >
            {d.query}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Repeat className="size-3" />
              {formatCompactNumber(d.cnt)} runs
            </span>
            {/* Each metric surfaces inline when its column is collapsed by the
                viewport (responsive `*:hidden`) or hidden in the column menu. */}
            <span
              className={cn(
                'inline-flex items-center gap-1',
                showCpu && 'lg:hidden'
              )}
            >
              <Cpu className="size-3" />
              {cpu.value} {cpu.unit}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                showMemory && 'md:hidden'
              )}
            >
              <MemoryStick className="size-3" />
              {d.readableMemory}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                showReadRows && 'xl:hidden'
              )}
            >
              <Database className="size-3" />
              {formatCompactNumber(d.readRows)} rows
            </span>
          </div>
        </td>

        {/* Total time — always visible */}
        <td className="px-2 py-2.5 sm:px-3">
          <TotalTimeCell d={d} max={maxDuration} />
        </td>

        {/* Runs — sm+ */}
        {showCnt && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[11px] tabular-nums sm:table-cell">
            {formatCompactNumber(d.cnt)}
          </td>
        )}

        {/* CPU time — lg+ (same number + bar % as Total time) */}
        {showCpu && (
          <td className="hidden px-3 py-2.5 lg:table-cell">
            <CpuCell d={d} max={maxCpu} align="right" />
          </td>
        )}

        {/* Memory — md+ (same number + bar % as Total time) */}
        {showMemory && (
          <td className="hidden px-3 py-2.5 md:table-cell">
            <MemoryCell d={d} max={maxMemory} align="right" />
          </td>
        )}

        {/* Rows read — xl+ */}
        {showReadRows && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[11px] tabular-nums text-muted-foreground xl:table-cell">
            {formatCompactNumber(d.readRows)}
          </td>
        )}

        {/* Actions */}
        <td className="px-1.5 py-2.5 sm:px-3">
          <div
            className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogSQL
              sql={d.query}
              title={`#${d.rank} · Most expensive query`}
              description="Full normalized query fingerprint"
              defaultBeautify
              button={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  aria-label="Show full query"
                >
                  <Code2 className="size-3.5" />
                </Button>
              }
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden size-7 text-muted-foreground hover:text-foreground md:inline-flex"
                    aria-label="Open in Explorer"
                    render={
                      <Link href={buildExplorerQueryUrl(d.query, hostId)} />
                    }
                  />
                }
              >
                <ExternalLink className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Open in Explorer</TooltipContent>
            </Tooltip>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={colSpan} className="p-0">
            <ExpandedRow d={d} />
          </td>
        </tr>
      )}
    </>
  )
})
