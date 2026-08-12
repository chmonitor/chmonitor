/**
 * Build the KPI/stat cards shown above the calendar for a chosen metric.
 */

import { formatCompactNumber } from '@/lib/format-readable'
import type { CalendarStats } from './build-model'
import { formatShortDate } from './date-utils'
import type { MetricConfig } from './metrics'

/** A single KPI/stat card shown above the calendar. */
export interface StatCard {
  label: string
  value: string
  sub?: string
  /** Highlight the value with the metric accent colour (used for the peak). */
  accent?: boolean
}

/**
 * Build the four KPI cards for a metric + model. `sum` metrics lead with a
 * grand total; `gauge` metrics lead with the peak reading (a sum would be
 * meaningless for e.g. peak memory).
 */
export function buildStatCards(
  metric: MetricConfig,
  model: CalendarStats
): StatCard[] {
  const { total, max, activeDays, totalDays, avgActive, peak } = model
  const hasTraffic = max > 0
  const pct = totalDays > 0 ? Math.round((activeDays * 100) / totalDays) : 0
  const peakDate = peak && hasTraffic ? formatShortDate(peak.date) : '—'

  if (metric.aggregation === 'gauge') {
    return [
      {
        label: `Peak ${metric.label.split(' ')[0]}`,
        value: hasTraffic ? metric.format(max) : '—',
        sub: 'highest daily reading',
        accent: true,
      },
      {
        label: 'Average',
        value: hasTraffic ? metric.format(avgActive) : '—',
        sub: 'across active days',
      },
      {
        label: 'Busiest day',
        value: peakDate,
        sub: hasTraffic ? 'when the peak occurred' : undefined,
      },
      {
        label: 'Active days',
        value: formatCompactNumber(activeDays),
        sub: `of ${totalDays} (${pct}%)`,
      },
    ]
  }

  // sum metrics — vary the wording per metric so the cards read naturally.
  const wording: Record<
    'queries' | 'failed' | 'written',
    { total: string; peak: string; active: string; avgNoun: string }
  > = {
    queries: {
      total: 'Total queries',
      peak: 'Busiest day',
      active: 'Active days',
      avgNoun: 'queries per active day',
    },
    failed: {
      total: 'Total failed',
      peak: 'Worst day',
      active: 'Days with errors',
      avgNoun: 'errors per active day',
    },
    written: {
      total: 'Total written',
      peak: 'Biggest day',
      active: 'Active days',
      avgNoun: 'per active day',
    },
  }
  const w = wording[metric.key as 'queries' | 'failed' | 'written']

  return [
    {
      label: w.total,
      value: metric.format(total),
      sub: `over ${totalDays} days`,
    },
    {
      label: w.peak,
      value: hasTraffic ? metric.format(max) : '—',
      sub: hasTraffic ? `${peakDate} · peak daily volume` : undefined,
      accent: true,
    },
    {
      label: w.active,
      value: formatCompactNumber(activeDays),
      sub: `of ${totalDays} (${pct}%)`,
    },
    {
      label: 'Avg / active day',
      value: hasTraffic ? metric.format(avgActive) : '—',
      sub: w.avgNoun,
    },
  ]
}
