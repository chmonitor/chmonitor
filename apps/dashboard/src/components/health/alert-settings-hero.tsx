import {
  BellRing,
  CircleAlert,
  Radio,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react'

import { useAlertHistory } from './use-alert-history'
import { type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
} from '@/lib/health/alert-settings-storage'
import { loadThresholds } from '@/lib/health/thresholds-storage'

/**
 * Deterministic sample series for the threshold demo — fixed values (no
 * Date/random) so SSR and client render identically and the preview never
 * depends on live data.
 */
const SAMPLE_SERIES = [
  22, 28, 25, 34, 31, 42, 38, 47, 55, 51, 63, 71, 66, 78, 84, 74, 69, 61, 52,
  44, 39, 33, 30, 26,
]
const SAMPLE_WARNING = 60
const SAMPLE_CRITICAL = 80

function ThresholdDemo() {
  const w = 320
  const h = 96
  const max = 100
  const stepX = w / (SAMPLE_SERIES.length - 1)
  const y = (v: number) => h - (v / max) * h
  const points = SAMPLE_SERIES.map((v, i) => `${i * stepX},${y(v)}`).join(' ')
  const area = `0,${h} ${points} ${w},${h}`
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-24 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Sample metric with warning and critical threshold lines"
    >
      <polygon points={area} fill="var(--chart-1)" opacity={0.12} />
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <line
        x1={0}
        x2={w}
        y1={y(SAMPLE_WARNING)}
        y2={y(SAMPLE_WARNING)}
        stroke="var(--chart-yellow)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <line
        x1={0}
        x2={w}
        y1={y(SAMPLE_CRITICAL)}
        y2={y(SAMPLE_CRITICAL)}
        stroke="var(--chart-red)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {SAMPLE_SERIES.map((v, i) =>
        v >= SAMPLE_CRITICAL ? (
          <circle
            key={`crit-${v}-${i * stepX}`}
            cx={i * stepX}
            cy={y(v)}
            r={2.5}
            fill="var(--chart-red)"
          />
        ) : null
      )}
    </svg>
  )
}

function StatTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  hint: string
}) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xl font-semibold tracking-tight">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
    </div>
  )
}

/**
 * Bento overview for the alert settings page: a sample threshold viz plus
 * at-a-glance stats (enabled channels, threshold overrides, 24h alert volume).
 * Counts come from local settings storage and the alert history API; the viz
 * is a deterministic sample, never a live query.
 */
export function AlertSettingsHero() {
  const [channelsEnabled, setChannelsEnabled] = useState<number>(0)
  const [overrides, setOverrides] = useState<number>(0)

  useEffect(() => {
    const s = loadAlertSettings() ?? DEFAULT_ALERT_SETTINGS
    setChannelsEnabled(
      [
        s.browserNotificationsEnabled,
        s.webhookEnabled,
        Boolean(s.healthchecksUrl),
      ].filter(Boolean).length
    )
    setOverrides(Object.keys(loadThresholds()).length)
  }, [])

  const { events } = useAlertHistory({ limit: 200 })
  const criticalCount = events.filter((e) => e.severity === 'critical').length

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm sm:col-span-2 lg:row-span-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <SlidersHorizontal className="size-4" strokeWidth={1.5} />
            <span className="text-xs font-medium">
              How thresholds fire alerts
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            Sample
          </Badge>
        </div>
        <ThresholdDemo />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t border-dashed border-[var(--chart-yellow)]" />
            Warning ≥ {SAMPLE_WARNING}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t border-dashed border-[var(--chart-red)]" />
            Critical ≥ {SAMPLE_CRITICAL}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Each health check compares its metric against your warning and
          critical thresholds; crossings fire alerts to every enabled channel,
          subject to severity floors, routing, quiet hours and maintenance
          windows.
        </p>
      </div>

      <StatTile
        icon={<Radio className="size-4" strokeWidth={1.5} />}
        label="Channels enabled"
        value={channelsEnabled}
        hint="Browser, webhook, healthchecks.io"
      />
      <StatTile
        icon={<SlidersHorizontal className="size-4" strokeWidth={1.5} />}
        label="Threshold overrides"
        value={overrides}
        hint="Checks tuned away from defaults"
      />
      <StatTile
        icon={<BellRing className="size-4" strokeWidth={1.5} />}
        label="Recent alerts"
        value={events.length}
        hint="Latest recorded alert events"
      />
      <StatTile
        icon={
          criticalCount > 0 ? (
            <TriangleAlert className="size-4" strokeWidth={1.5} />
          ) : (
            <CircleAlert className="size-4" strokeWidth={1.5} />
          )
        }
        label="Critical"
        value={criticalCount}
        hint="Critical events in recent history"
      />
    </div>
  )
}
