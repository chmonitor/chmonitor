import { FolderOpen, HardDrive } from 'lucide-react'

import type { Row as DiskRow } from '@/lib/query-config/system/disks'

import { DiskUsageBar, usageLevel } from './disk-usage-bar'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type { DiskRow }

const LEVEL_ACCENT: Record<ReturnType<typeof usageLevel>, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
}

function percentUsedOf(disk: DiskRow): number {
  if (disk.total_space > 0) {
    return (disk.used_space / disk.total_space) * 100
  }
  // Fall back to derived value from percent_free (e.g. "12.34%")
  const free = Number.parseFloat(disk.percent_free)
  return Number.isFinite(free) ? 100 - free : 0
}

interface MetricProps {
  label: string
  value: string
  className?: string
}

function Metric({ label, value, className }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn('text-sm font-semibold tabular-nums', className)}>
        {value}
      </span>
    </div>
  )
}

export function DiskCard({ disk }: { disk: DiskRow }) {
  const percentUsed = percentUsedOf(disk)
  const level = usageLevel(percentUsed)
  const accent = LEVEL_ACCENT[level]

  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardHeader className="gap-1 p-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-semibold leading-none tracking-tight">
              {disk.name}
            </span>
          </div>
          {disk.type ? (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {disk.type}
            </span>
          ) : null}
        </div>
        {disk.path ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate font-mono" title={disk.path}>
              {disk.path}
            </span>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="mt-auto flex flex-col gap-3 p-4 pt-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">
              {disk.readable_used_space} used
            </span>
            <span className={cn('text-sm font-semibold tabular-nums', accent)}>
              {percentUsed.toFixed(1)}%
            </span>
          </div>
          <DiskUsageBar percentUsed={percentUsed} />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{disk.readable_free_space} free</span>
            <span>{disk.readable_total_space} total</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <Metric label="Unreserved" value={disk.readable_unreserved_space} />
          <Metric label="Free" value={disk.readable_free_space} />
        </div>
      </CardContent>
    </Card>
  )
}
