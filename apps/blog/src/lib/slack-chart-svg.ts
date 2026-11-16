/**
 * Draws a Slack data_visualization block as an inline SVG chart card, from
 * the block's chart object alone. Slack draws the real one in its own style;
 * this is the page's rendering of the same JSON.
 */

import type {
  AxisChart,
  ChartSeries,
  DataVisualizationBlock,
  PieChart,
} from './slack-chart-block'

import { esc } from './slack-mrkdwn'

interface Box {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

/** Two drawings, because SVG text scales with the box and gets too small on a phone. */
const WIDTHS = { wide: 560, narrow: 320 }
/** Width of one character of the 11px monospace tick text, plus the gap between ticks. */
const CHAR_W = 6.6
const TICK_GAP = 8

/**
 * Series drawn as thresholds, by name. Slack has no threshold concept and
 * draws these as ordinary series. The page colours them with the status
 * tokens, dashed on line and area charts.
 */
const THRESHOLDS = new Set(['warn', 'crit'])
const isThreshold = (s: ChartSeries) => THRESHOLDS.has(s.name)

const round = (n: number) => Math.round(n * 10) / 10
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Steps of one hue, so series stay apart without turning into a rainbow. */
function ramp(i: number, n: number): string {
  const step = n > 1 ? Math.min(20, 60 / (n - 1)) : 0
  return `color-mix(in oklab, var(--slack-chart-series) ${round(100 - i * step)}%, var(--card))`
}

function seriesColor(series: ChartSeries, data: ChartSeries[]): string {
  return isThreshold(series)
    ? `var(--slack-chart-${series.name})`
    : ramp(data.indexOf(series), data.length)
}

/** Four or so round steps (1, 2, 2.5 or 5 times a power of ten) covering min..max. */
function niceTicks(min: number, max: number): number[] {
  const [lo0, hi0] = min === max ? [min - 1, max + 1] : [min, max]
  const raw = (hi0 - lo0) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const lo = Math.floor(lo0 / step) * step
  const count = Math.ceil(hi0 / step) - Math.floor(lo0 / step)
  return Array.from({ length: count + 1 }, (_, i) =>
    Number((lo + i * step).toFixed(10))
  )
}

/** Category indexes to label, stepping back from the latest so ticks never overlap. */
function thinned(categories: string[], spacing: number): number[] {
  const widest =
    Math.max(...categories.map((c) => c.length)) * CHAR_W + TICK_GAP
  const every = Math.max(1, Math.ceil(widest / spacing))
  const out: number[] = []
  for (let i = categories.length - 1; i >= 0; i -= every) out.unshift(i)
  return out
}

/** A series' values in category order; the validator made every category present. */
function valuesOf(series: ChartSeries, categories: string[]): number[] {
  const byLabel = new Map(series.data.map((p) => [p.label, p.value]))
  return categories.map((c) => byLabel.get(c) as number)
}

function axisSummary(chart: AxisChart): string {
  const { categories, x_label, y_label } = chart.axis_config
  const kind = { line: 'Line', area: 'Area', bar: 'Bar' }[chart.type]
  const n = categories.length
  const parts = [
    n === 1
      ? `${kind} chart for ${categories[0]}.`
      : `${kind} chart, ${n} points from ${categories[0]} to ${categories[n - 1]}.`,
  ]
  if (x_label) parts.push(`x: ${x_label}.`)
  if (y_label) parts.push(`y: ${y_label}.`)
  for (const s of chart.series) {
    const values = valuesOf(s, categories)
    const [min, max, last] = [
      Math.min(...values),
      Math.max(...values),
      values[n - 1],
    ].map((v) => plain.format(v))
    parts.push(
      min === max
        ? `${s.name}: ${min}.`
        : `${s.name}: min ${min}, max ${max}, last ${last}.`
    )
  }
  return parts.join(' ')
}

function axisSvg(
  chart: AxisChart,
  width: number,
  variant: string,
  title: string
): string {
  const { categories, x_label, y_label } = chart.axis_config
  const data = chart.series.filter((s) => !isThreshold(s))
  const lines = chart.type !== 'bar'
  const box: Box = {
    width,
    height: 200,
    top: 10,
    right: lines && data.length < chart.series.length ? 60 : 12,
    bottom: x_label ? 42 : 24,
    left: y_label ? 56 : 40,
  }
  const plot = {
    left: box.left,
    right: box.width - box.right,
    top: box.top,
    bottom: box.height - box.bottom,
  }
  const plotW = plot.right - plot.left
  const values = chart.series.flatMap((s) => s.data.map((p) => p.value))
  const range = chart.type === 'line' ? values : [...values, 0]
  const ticks = niceTicks(Math.min(...range), Math.max(...range))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const fmt = Math.max(...ticks.map(Math.abs)) >= 10_000 ? compact : plain
  const y = (v: number) =>
    round(plot.top + ((hi - v) * (plot.bottom - plot.top)) / (hi - lo))
  const n = categories.length
  const band = plotW / n
  const x = (i: number) =>
    round(
      !lines
        ? plot.left + band * (i + 0.5)
        : n > 1
          ? plot.left + (i * plotW) / (n - 1)
          : plot.left + plotW / 2
    )
  const base = chart.type === 'line' ? plot.bottom : y(0)

  const out: string[] = []
  for (const t of ticks) {
    out.push(
      `<line class="slack-chart-grid" x1="${plot.left}" x2="${plot.right}" y1="${y(t)}" y2="${y(t)}"/>`,
      `<text class="slack-chart-tick slack-chart-y" x="${plot.left - 6}" y="${y(t) + 4}" text-anchor="end">${fmt.format(t)}</text>`
    )
  }
  out.push(
    `<line class="slack-chart-base" x1="${plot.left}" x2="${plot.right}" y1="${base}" y2="${base}"/>`
  )
  for (const i of thinned(
    categories,
    lines && n > 1 ? plotW / (n - 1) : band
  )) {
    out.push(
      `<text class="slack-chart-tick slack-chart-x" x="${x(i)}" y="${plot.bottom + 16}" text-anchor="middle">${esc(categories[i])}</text>`
    )
  }
  if (x_label) {
    out.push(
      `<text class="slack-chart-axis-title" x="${round(plot.left + plotW / 2)}" y="${box.height - 6}" text-anchor="middle">${esc(x_label)}</text>`
    )
  }
  if (y_label) {
    out.push(
      `<text class="slack-chart-axis-title" transform="rotate(-90)" x="${-round((plot.top + plot.bottom) / 2)}" y="14" text-anchor="middle">${esc(y_label)}</text>`
    )
  }

  const barW = (band * 0.8) / chart.series.length
  // Thresholds go behind the data so the data line stays on top.
  const drawOrder = lines
    ? [...chart.series.filter(isThreshold), ...data]
    : chart.series
  for (const s of drawOrder) {
    const si = chart.series.indexOf(s)
    const vs = valuesOf(s, categories)
    const style = `style="--c: ${seriesColor(s, data)}"`
    if (!lines) {
      for (const [i, v] of vs.entries()) {
        const left = plot.left + band * i + band * 0.1 + barW * si
        out.push(
          `<rect class="slack-chart-bar" x="${round(left + 1)}" y="${Math.min(y(v), base)}" width="${round(Math.max(barW - 2, 1))}" height="${round(Math.abs(y(v) - base))}" ${style}/>`
        )
      }
      continue
    }
    const points = vs.map((v, i) => `${x(i)} ${y(v)}`)
    const path = `M${points.join(' L')}`
    const last = { x: x(n - 1), y: y(vs[n - 1]), value: vs[n - 1] }
    if (isThreshold(s)) {
      out.push(
        `<path class="slack-chart-line slack-chart-dashed" d="${path}" ${style}/>`,
        `<text class="slack-chart-threshold" x="${plot.right + 6}" y="${last.y + 4}">${esc(s.name)} ${fmt.format(last.value)}</text>`
      )
      continue
    }
    if (chart.type === 'area') {
      out.push(
        `<path class="slack-chart-area" d="${path} L${last.x} ${base} L${x(0)} ${base} Z" ${style}/>`
      )
    }
    out.push(
      `<path class="slack-chart-line" d="${path}" ${style}/>`,
      `<circle class="slack-chart-dot" cx="${last.x}" cy="${last.y}" r="3.5" ${style}/>`
    )
    if (data.length === 1) {
      out.push(
        `<text class="slack-chart-value" x="${last.x - 8}" y="${last.y - 8}" text-anchor="end">${fmt.format(last.value)}</text>`
      )
    }
  }

  return `<svg class="slack-chart-svg slack-chart-${variant}" viewBox="0 0 ${box.width} ${box.height}" role="img"><title>${title}</title><desc>${esc(axisSummary(chart))}</desc>${out.join('')}</svg>`
}

const share = (value: number, total: number) =>
  Math.round((value / total) * 100)

function pieSvg(chart: PieChart, title: string): string {
  const c = 80
  const r = 76
  const total = chart.segments.reduce((sum, s) => sum + s.value, 0)
  const n = chart.segments.length
  const at = (a: number) =>
    `${round(c + r * Math.sin(a))} ${round(c - r * Math.cos(a))}`
  let angle = 0
  const slices = chart.segments.map((s, i) => {
    const style = `style="--c: ${ramp(i, n)}"`
    if (n === 1)
      return `<circle class="slack-chart-slice" cx="${c}" cy="${c}" r="${r}" ${style}/>`
    const start = angle
    angle += (s.value / total) * 2 * Math.PI
    const large = angle - start > Math.PI ? 1 : 0
    return `<path class="slack-chart-slice" d="M${c} ${c} L${at(start)} A${r} ${r} 0 ${large} 1 ${at(angle)} Z" ${style}/>`
  })
  const parts = chart.segments.map(
    (s) => `${s.label} ${share(s.value, total)}% (${plain.format(s.value)})`
  )
  const desc = `Pie chart of ${n} ${n === 1 ? 'slice' : 'slices'}: ${parts.join(', ')}.`
  return `<svg class="slack-chart-svg slack-chart-pie" viewBox="0 0 ${2 * c} ${2 * c}" role="img"><title>${title}</title><desc>${esc(desc)}</desc>${slices.join('')}</svg>`
}

function legendHtml(
  items: { text: string; color: string; dashed: boolean }[]
): string {
  const li = items.map(
    (item) =>
      `<li><span class="slack-chart-swatch${item.dashed ? ' slack-chart-dashed' : ''}" style="--c: ${item.color}"></span>${esc(item.text)}</li>`
  )
  return `<ul class="slack-chart-legend">${li.join('')}</ul>`
}

/** The chart card for one block: title, wide and narrow drawings, legend. */
export function chartHtml(block: DataVisualizationBlock): string {
  const { chart } = block
  const title = esc(block.title)
  let body: string
  let legend = ''
  if (chart.type === 'pie') {
    const total = chart.segments.reduce((sum, s) => sum + s.value, 0)
    body = pieSvg(chart, title)
    legend = legendHtml(
      chart.segments.map((s, i) => ({
        text: `${s.label} ${share(s.value, total)}%`,
        color: ramp(i, chart.segments.length),
        dashed: false,
      }))
    )
  } else {
    body = (['wide', 'narrow'] as const)
      .map((v) => axisSvg(chart, WIDTHS[v], v, title))
      .join('')
    const data = chart.series.filter((s) => !isThreshold(s))
    if (chart.series.length > 1) {
      legend = legendHtml(
        chart.series.map((s) => ({
          text: s.name,
          color: seriesColor(s, data),
          dashed: chart.type !== 'bar' && isThreshold(s),
        }))
      )
    }
  }
  return `<div class="slack-chart"><p class="slack-chart-title">${title}</p><div class="slack-chart-plot">${body}</div>${legend}</div>`
}
