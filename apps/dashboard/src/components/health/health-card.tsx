import type { ComputedCheck, HealthStatus } from '@/lib/health/health-status'
import type { Thresholds } from '@/lib/health/thresholds-storage'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCheckDef } from './health-checks'

import { HealthCardShell } from './health-card-shell'
import { HealthDetailDialog } from './health-detail-dialog'
import { useState } from 'react'

// Re-exported for modules that import the status union from here.
export type { HealthStatus }

interface HealthCardProps {
  check: HealthCheckDef
  thresholds: Thresholds
  hostId: number
  /** Status/value/label resolved upstream in the grid. */
  computed: ComputedCheck
  /** Observed values, oldest first, for the trend sparkline. */
  spark?: number[]
  /** ClickHouse version, forwarded to the detail dialog. */
  clickhouseVersion?: string
  /** Expanded card (issues) or dense row (healthy) — decided by the grid. */
  variant?: HealthCardVariant
}

/**
 * A single health check card. Presentational: the grid computes status (so it
 * can sort/count/filter) and hands it down. The card renders the shared shell
 * and owns only its own detail dialog.
 */
export function HealthCard({
  check,
  thresholds,
  hostId,
  computed,
  spark,
  clickhouseVersion,
  variant,
}: HealthCardProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const { status, value, label, displayValue, row } = computed

  return (
    <>
      <HealthCardShell
        icon={check.icon}
        title={check.title}
        status={status}
        displayValue={displayValue}
        sublabel={label}
        spark={spark}
        links={check.relatedLinks}
        hostId={hostId}
        onExpand={() => setDetailOpen(true)}
        variant={variant}
      />

      <HealthDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        check={check}
        hostId={hostId}
        status={status}
        value={value}
        label={label}
        thresholds={thresholds}
        row={row}
        clickhouseVersion={clickhouseVersion}
      />
    </>
  )
}
