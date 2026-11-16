import type { DemoTrend } from './slack-fixtures'

export interface TrendBox {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

const round = (n: number) => Math.round(n * 10) / 10

/**
 * Where each part of a trend chart goes inside `box`. The y range covers the
 * series and both thresholds, padded by a tenth and rounded out to 5, so the
 * threshold lines are always on the chart.
 */
export function trendLayout(trend: DemoTrend, box: TrendBox) {
  const { series, warn, crit } = trend
  const all = [...series, warn, crit]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min) / 10
  const lo = Math.floor((min - pad) / 5) * 5
  const hi = Math.max(Math.ceil((max + pad) / 5) * 5, lo + 5)
  const plotW = box.width - box.left - box.right
  const plotH = box.height - box.top - box.bottom
  const base = box.top + plotH
  const x = (i: number) =>
    round(
      box.left + (series.length > 1 ? (i * plotW) / (series.length - 1) : 0)
    )
  const y = (v: number) => round(box.top + ((hi - v) * plotH) / (hi - lo))
  const points = series.map((v, i) => `${x(i)} ${y(v)}`)
  const line = `M${points.join(' L')}`
  const lastIndex = series.length - 1
  return {
    lo,
    hi,
    base,
    line,
    area: `${line} L${x(lastIndex)} ${base} L${x(0)} ${base} Z`,
    warnY: y(warn),
    critY: y(crit),
    loY: y(lo),
    hiY: y(hi),
    last: {
      x: x(lastIndex),
      y: y(series[lastIndex]),
      value: series[lastIndex],
    },
  }
}
