import { Clock } from 'lucide-react'

import { KpiCard } from './kpi-card'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { useHostStatus } from '@/lib/swr/use-host-status'

/**
 * ClickHouseInfoCard - "Uptime" overview KPI.
 * Headline is a compact uptime (e.g. "12d 1h"); the version sits below.
 * Falls back to showing the version as the headline when uptime is missing.
 */

const UNIT_ABBR: Record<string, string> = {
  year: 'y',
  month: 'mo',
  week: 'w',
  day: 'd',
  hour: 'h',
  minute: 'm',
  second: 's',
}

/**
 * Condense a human uptime string ("12 days, 1 hour and 20 minutes") into the
 * two most significant parts ("12d 1h").
 *
 * Units outside {@link UNIT_ABBR} are dropped; if nothing matches, the
 * original trimmed string is returned unchanged.
 */
function compactUptime(uptime: string): string {
  const matches = uptime.matchAll(
    /(\d+)\s*(year|month|week|day|hour|minute|second)s?/gi
  )
  const parts = Array.from(matches, (m) => ({
    n: Number(m[1]),
    unit: UNIT_ABBR[m[2].toLowerCase()],
  })).filter((p) => p.n > 0 && p.unit)

  if (parts.length === 0) return uptime.trim()
  return parts
    .slice(0, 2)
    .map((p) => `${p.n}${p.unit}`)
    .join(' ')
}

export const ClickHouseInfoCard = function ClickHouseInfoCard() {
  const hostId = useHostId()
  const statusSwr = useHostStatus(hostId, {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  const version = statusSwr.data?.version ? `v${statusSwr.data.version}` : '-'
  const uptime = statusSwr.data?.uptime ?? ''
  const compact = uptime ? compactUptime(uptime) : ''

  return (
    <KpiCard
      icon={Clock}
      tone="green"
      label={compact ? 'Uptime' : 'Version'}
      value={compact || version}
      sub={compact ? version : undefined}
      isLoading={statusSwr.isLoading}
    />
  )
}
