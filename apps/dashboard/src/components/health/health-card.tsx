import type { MetricAlertSignals } from '@/lib/health/alert-capability'
import type { ComputedCheck, HealthStatus } from '@/lib/health/health-status'
import type { Thresholds } from '@/lib/health/thresholds-storage'
import type { HealthCardVariant } from './health-card-shell'
import type { HealthCheckDef } from './health-checks'
import type { AlertRuleStoreAvailability } from './use-alert-signals'

import { AlertConfiguredBadge } from './alert-configured-badge'
import { HealthCardShell } from './health-card-shell'
import { HealthDetailDialog } from './health-detail-dialog'
import { NO_ALERT_SIGNALS } from './use-alert-signals'
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
  /** Already-alerting state for this check, resolved upstream (#3437). */
  signals?: MetricAlertSignals
  /** Whether the D1-backed named-alert store can be written here (#3437). */
  availability?: AlertRuleStoreAvailability
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
  signals = NO_ALERT_SIGNALS,
  availability = 'unknown',
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
        badge={<AlertConfiguredBadge signals={signals} />}
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
        signals={signals}
        availability={availability}
      />
    </>
  )
}
