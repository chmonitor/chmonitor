import {
  ChevronRight,
  CircleX,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  Loader2,
  MemoryStick,
  ScanSearch,
  User as UserIcon,
  Workflow,
  X,
} from 'lucide-react'

import { CpuMeter, DoneBadge, ProgressCell } from './cells'
import { ExpandedRow } from './expanded-row'
import {
  BASE_COLUMN_COUNT,
  type DerivedQuery,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  SEVERITY_DURATION,
} from './types'
import { useKillQuery } from './use-kill-query'
import { memo } from 'react'
import { formatDuration } from '@/components/query-tables/format-duration'
import { KindBadge } from '@/components/query-tables/kind-badge'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatReadableSize } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface QueryRowProps {
  d: DerivedQuery
  expanded: boolean
  onToggle: () => void
  hiddenColumns: Set<OptionalColumn>
  /** Query has finished and its row is retained in a "Done" state. */
  done?: boolean
  /** Drop this retained Done row from the table. */
  onDismiss?: () => void
}

/** One running query rendered as a table row (collapsed) + detail row. */
export const QueryRow = memo(function QueryRow({
  d,
  expanded,
  onToggle,
  hiddenColumns,
  done,
  onDismiss,
}: QueryRowProps) {
  const hostId = useHostId()
  const { isKilling, handleKill } = useKillQuery(d.id)
  const queryDetailUrl = d.id
    ? `/query?query_id=${encodeURIComponent(d.id)}&host=${hostId}`
    : ''
  const explainUrl = d.id
    ? buildUrl('/explain', { query_id: d.id, host: hostId })
    : ''

  const dur = formatDuration(d.elapsed)
  const showMemory = !hiddenColumns.has('memory')
  const showData = !hiddenColumns.has('dataRead')
  const showCpu = !hiddenColumns.has('cpu')
  const showThreads = !hiddenColumns.has('threads')
  const showDuration = !hiddenColumns.has('duration')
  const colSpan =
    BASE_COLUMN_COUNT + (OPTIONAL_COLUMNS.length - hiddenColumns.size)

  return (
    <>
      <tr
        className={cn(
          'group animate-in cursor-pointer border-b border-border align-middle fade-in-0 slide-in-from-top-1 duration-300 hover:bg-muted/60',
          done &&
            'bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30'
        )}
        onClick={onToggle}
      >
        {/* Type + expand chevron */}
        <td className="px-2 py-2.5 sm:px-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ChevronRight
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
            {done && <DoneBadge />}
            <KindBadge kind={d.kind} />
          </div>
        </td>

        {/* Query text + meta line (carries hidden-column values on small screens) */}
        <td className="min-w-0 px-2 py-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className="block min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground sm:text-[12px]"
              title={d.query}
            >
              {d.query}
            </span>
            <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline">
              #{d.id ? d.id.slice(0, 8) : 'n/a'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-mono md:hidden">
              #{d.id ? d.id.slice(0, 8) : 'n/a'}
            </span>
            {d.user && (
              <span className="inline-flex items-center gap-1">
                <UserIcon className="size-3" />
                {d.user}
              </span>
            )}
            {d.db && (
              <span className="inline-flex items-center gap-1">
                <Database className="size-3" />
                {d.db}
              </span>
            )}
            {d.iface && (
              <span className="inline-flex items-center gap-1">
                <Globe className="size-3" />
                {d.iface}
              </span>
            )}
            {/* Each metric surfaces inline when its column is unavailable —
                either collapsed by the viewport (responsive `*:hidden`) or
                switched off in the column menu (no responsive class, so it
                stays visible). */}
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
                showCpu && 'lg:hidden'
              )}
            >
              <Cpu className="size-3" />
              {Math.round(d.cpuPct)}%
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                showData && 'xl:hidden'
              )}
            >
              <HardDrive className="size-3" />
              {formatReadableSize(d.readBytes)}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                showDuration && 'sm:hidden'
              )}
            >
              <Clock className="size-3" />
              {dur.value} {dur.unit}
            </span>
          </div>
        </td>

        {/* Progress — always visible */}
        <td className="px-2 py-2.5 sm:px-3">
          <ProgressCell d={d} done={done} />
        </td>

        {/* Memory — md+ */}
        {showMemory && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums md:table-cell">
            {d.readableMemory}
          </td>
        )}

        {/* Data read — xl+ */}
        {showData && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums xl:table-cell">
            {formatReadableSize(d.readBytes)}
          </td>
        )}

        {/* CPU — lg+ */}
        {showCpu && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums lg:table-cell">
            {d.cpuPct > 0 ? (
              <CpuMeter pct={d.cpuPct} />
            ) : (
              <span className="text-muted-foreground">0%</span>
            )}
          </td>
        )}

        {/* Threads — 2xl+ */}
        {showThreads && (
          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] tabular-nums text-muted-foreground 2xl:table-cell">
            {d.threads || 0}
          </td>
        )}

        {/* Duration — sm+ (lives in the meta line on xs) */}
        {showDuration && (
          <td className="hidden whitespace-nowrap px-2 py-2.5 text-right text-[12px] tabular-nums sm:table-cell sm:px-3">
            <span className={cn(!done && SEVERITY_DURATION[d.severity])}>
              {dur.value}
              <span className="ml-0.5 text-[10.5px] text-muted-foreground">
                {dur.unit}
              </span>
            </span>
          </td>
        )}

        {/* Actions */}
        <td className="px-1.5 py-2.5 sm:px-3">
          <div
            className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      onClick={onDismiss}
                      aria-label="Dismiss finished query"
                    />
                  }
                >
                  <X className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-rose-600"
                      onClick={handleKill}
                      disabled={isKilling || !d.id}
                      aria-label="Kill query"
                    />
                  }
                >
                  {isKilling ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CircleX className="size-3.5" />
                  )}
                </TooltipTrigger>
                <TooltipContent>Kill query</TooltipContent>
              </Tooltip>
            )}
            {explainUrl && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden size-7 text-muted-foreground hover:text-foreground md:inline-flex"
                      aria-label="Explain query"
                      render={<Link href={explainUrl} />}
                    />
                  }
                >
                  <Workflow className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Explain query</TooltipContent>
              </Tooltip>
            )}
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden size-7 text-muted-foreground hover:text-foreground md:inline-flex"
                    aria-label={
                      queryDetailUrl ? 'Query detail' : 'Query ID unavailable'
                    }
                    disabled={!queryDetailUrl}
                    render={
                      queryDetailUrl ? (
                        <Link href={queryDetailUrl}>
                          <ScanSearch className="size-3.5" />
                        </Link>
                      ) : (
                        <span>
                          <ScanSearch className="size-3.5" />
                        </span>
                      )
                    }
                  />
                }
              />
              <TooltipContent>
                {queryDetailUrl ? 'Query detail' : 'Query ID unavailable'}
              </TooltipContent>
            </Tooltip>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={colSpan} className="p-0">
            <ExpandedRow
              d={d}
              onKill={handleKill}
              isKilling={isKilling}
              done={done}
              onDismiss={onDismiss}
            />
          </td>
        </tr>
      )}
    </>
  )
})
