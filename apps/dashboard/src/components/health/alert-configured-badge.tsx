'use client'

/** Not gated on the metadata database: the `threshold` signal comes from localStorage. */

import { BellRing } from 'lucide-react'

import type { MetricAlertSignals } from '@/lib/health/alert-capability'

import { Badge } from '@/components/ui/badge'
import { describeAlertSignals } from '@/lib/health/alert-capability'
import { cn } from '@/lib/utils'

export function AlertConfiguredBadge({
  signals,
  className,
}: {
  signals: MetricAlertSignals
  className?: string
}) {
  const summary = describeAlertSignals(signals)
  if (!summary) return null
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300',
        className
      )}
      title={`This metric already alerts: ${summary}`}
    >
      <BellRing className="size-3" aria-hidden />
      Alerting
    </Badge>
  )
}
