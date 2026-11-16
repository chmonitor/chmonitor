/**
 * Charts for Slack (pure). An alert's recent values are drawn as a native
 * line chart (Block Kit's `data_visualization` block), or, where Slack does
 * not take that block, as one line of Unicode bars inside a code span, where
 * every bar is one monospace cell.
 */

const BARS = '▁▂▃▄▅▆▇█'
const FLAT = '▄'

/** Default bar count: fits a phone-width Slack thread with its labels. */
const DEFAULT_WIDTH = 24

export interface SlackSparklineOptions {
  warn?: number | null
  crit?: number | null
  /** Most bars drawn. A longer series is cut into this many buckets. */
  width?: number
}

function numberText(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Cut `items` into at most `width` runs in order; none is empty. */
function buckets<T>(items: readonly T[], width: number): T[][] {
  if (items.length <= width) return items.map((item) => [item])
  return Array.from({ length: width }, (_, i) =>
    items.slice(
      Math.floor((i * items.length) / width),
      Math.floor(((i + 1) * items.length) / width)
    )
  )
}

/** Bucket by max so a short spike in a long series still shows. */
function downsample(values: readonly number[], width: number): number[] {
  return buckets(values, width).map((run) =>
    run.reduce((a, b) => Math.max(a, b))
  )
}

/**
 * One mrkdwn code span such as `▁▂▅▇█ 12 → 97 (warn 80)`: bars scaled from
 * the series min to max, then first → last value. The min and max are
 * labelled only when neither end already shows them. Null and non-finite
 * points are skipped; with none left the result is ''.
 */
export function buildSlackSparkline(
  values: readonly (number | null | undefined)[],
  options: SlackSparklineOptions = {}
): string {
  const points = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  const min = points.reduce((a, b) => Math.min(a, b))
  const max = points.reduce((a, b) => Math.max(a, b))
  const bars = downsample(points, options.width ?? DEFAULT_WIDTH)
    .map((v) =>
      max === min
        ? FLAT
        : BARS[Math.round(((v - min) / (max - min)) * (BARS.length - 1))]
    )
    .join('')

  const ends =
    points.length === 1
      ? numberText(first)
      : `${numberText(first)} → ${numberText(last)}`
  const notes: string[] = []
  if (min !== first && min !== last) notes.push(`min ${numberText(min)}`)
  if (max !== first && max !== last) notes.push(`max ${numberText(max)}`)
  for (const [label, threshold] of [
    ['warn', options.warn],
    ['crit', options.crit],
  ] as const) {
    if (typeof threshold === 'number' && Number.isFinite(threshold)) {
      notes.push(`${label} ${numberText(threshold)}`)
    }
  }
  const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : ''
  return `\`${bars} ${ends}${suffix}\``
}

// --- Native chart: the data_visualization block ---------------------------

/**
 * Limits of the `data_visualization` block, from
 * docs.slack.dev/reference/block-kit/blocks/data-visualization-block
 * (read 2026-11-16). The page also allows at most 2 such blocks per message.
 * It does not say whether incoming webhooks take the block, which scope it
 * needs, or whether it is in beta.
 */
const LIMITS = {
  title: 50,
  label: 20,
  axisLabel: 50,
  series: 12,
  points: 20,
  segments: 12,
} as const

export interface SlackChartDataPoint {
  /** One of the chart's categories. */
  label: string
  value: number
}

export interface SlackChartSeries {
  /** Legend name, unique within the chart. */
  name: string
  /** Exactly one point per category. */
  data: SlackChartDataPoint[]
}

export interface SlackPieChart {
  type: 'pie'
  segments: { label: string; value: number }[]
}

/** A chart over an x axis of categories: bar, area or line. */
export interface SlackSeriesChart {
  type: 'bar' | 'area' | 'line'
  series: SlackChartSeries[]
  axis_config: {
    /** The x axis, left to right. */
    categories: string[]
    x_label?: string
    y_label?: string
  }
}

export type SlackChart = SlackPieChart | SlackSeriesChart

export interface SlackDataVisualizationBlock {
  type: 'data_visualization'
  title: string
  block_id?: string
  chart: SlackChart
}

/**
 * The documented limits `block` breaks, one line each; empty when Slack's
 * reference allows it. Empty strings count as broken: the reference marks
 * every one of them required.
 */
export function validateDataVisualization(
  block: SlackDataVisualizationBlock
): string[] {
  const problems: string[] = []
  const checkText = (what: string, text: string, max: number) => {
    if (text.length === 0) problems.push(`${what} is empty`)
    else if (text.length > max) problems.push(`${what} over ${max} chars`)
  }
  checkText('title', block.title, LIMITS.title)
  const { chart } = block
  if (chart.type === 'pie') {
    const count = chart.segments.length
    if (count < 1 || count > LIMITS.segments) {
      problems.push(`${count} segments`)
    }
    chart.segments.forEach((segment, i) => {
      checkText(`segment ${i} label`, segment.label, LIMITS.label)
      if (!(Number.isFinite(segment.value) && segment.value > 0)) {
        problems.push(`segment ${i} value ${segment.value}`)
      }
    })
    return problems
  }

  const { categories, x_label, y_label } = chart.axis_config
  if (categories.length < 1 || categories.length > LIMITS.points) {
    problems.push(`${categories.length} categories`)
  }
  if (new Set(categories).size !== categories.length) {
    problems.push('duplicate categories')
  }
  categories.forEach((c, i) => checkText(`category ${i}`, c, LIMITS.label))
  if (x_label !== undefined) checkText('x_label', x_label, LIMITS.axisLabel)
  if (y_label !== undefined) checkText('y_label', y_label, LIMITS.axisLabel)

  const count = chart.series.length
  if (count < 1 || count > LIMITS.series) problems.push(`${count} series`)
  if (new Set(chart.series.map((s) => s.name)).size !== count) {
    problems.push('duplicate series names')
  }
  for (const series of chart.series) {
    checkText(`series ${series.name} name`, series.name, LIMITS.label)
    const labels = series.data.map((p) => p.label)
    if (
      labels.length !== categories.length ||
      !categories.every((c) => labels.includes(c))
    ) {
      problems.push(`series ${series.name} needs one point per category`)
    }
    for (const point of series.data) {
      if (!Number.isFinite(point.value)) {
        problems.push(
          `series ${series.name} value ${point.value} at ${point.label}`
        )
      }
    }
  }
  return problems
}

/** Whether a Block Kit block is a native chart. */
export function isSlackChartBlock(
  block: unknown
): block is SlackDataVisualizationBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'data_visualization'
  )
}

/** One recorded value at an ISO time. A null or non-finite value is a gap. */
export interface SlackChartPoint {
  at: string
  value: number | null | undefined
}

export interface SlackLineChartInput {
  title: string
  /** Names the value line and, with no unit, the y axis. */
  metric: string
  unit?: string
  points: readonly SlackChartPoint[]
  warn?: number | null
  crit?: number | null
}

/** Fewer points than this is a line Slack draws no better than the sparkline. */
const MIN_CHART_POINTS = 3

const MINUTE_MS = 60_000

/** Cut to `max` UTF-16 units with an ellipsis, never inside a character. */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  let out = ''
  for (const char of text) {
    if (out.length + char.length > max - 1) break
    out += char
  }
  return `${out}…`
}

/**
 * Usable points in time order, one per UTC minute (the label's precision),
 * at that minute's max so a spike is never averaged away.
 */
function pointsByMinute(
  points: readonly SlackChartPoint[]
): { minute: number; value: number }[] {
  const usable = points
    .flatMap(({ at, value }) => {
      const time = Date.parse(at)
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        Number.isFinite(time)
        ? [{ minute: Math.floor(time / MINUTE_MS) * MINUTE_MS, value }]
        : []
    })
    .sort((a, b) => a.minute - b.minute)
  const out: { minute: number; value: number }[] = []
  for (const point of usable) {
    const last = out.at(-1)
    if (last?.minute === point.minute) {
      last.value = Math.max(last.value, point.value)
    } else {
      out.push({ ...point })
    }
  }
  return out
}

/** `HH:MM` UTC, or `MM-DD HH:MM` when the chart spans more than one UTC day. */
function timeLabels(minutes: readonly number[]): string[] {
  const isos = minutes.map((m) => new Date(m).toISOString())
  const oneDay = isos.every((iso) => iso.slice(0, 10) === isos[0].slice(0, 10))
  return isos.map((iso) =>
    oneDay ? iso.slice(11, 16) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}`
  )
}

/**
 * An alert's recent values as a native Slack line chart: one line for the
 * value and a flat line per finite threshold, over short UTC time labels.
 * More than 20 points are cut into 20 runs, each drawn at its max and
 * labelled with its last time, so the newest label is the newest value's.
 * Null with fewer than 3 usable minutes, and also when the result would break
 * a limit Slack documents, so it never returns a block Slack must reject.
 */
export function buildSlackLineChart(
  input: SlackLineChartInput
): SlackDataVisualizationBlock | null {
  const minutes = pointsByMinute(input.points)
  if (minutes.length < MIN_CHART_POINTS) return null
  const runs = buckets(minutes, LIMITS.points)
  const categories = timeLabels(runs.map((run) => run[run.length - 1].minute))
  const line = (name: string, values: readonly number[]): SlackChartSeries => ({
    name,
    data: categories.map((label, i) => ({ label, value: values[i] })),
  })
  const thresholds = (
    [
      ['warn', input.warn],
      ['crit', input.crit],
    ] as const
  ).flatMap(([name, value]) =>
    typeof value === 'number' && Number.isFinite(value)
      ? [
          line(
            name,
            categories.map(() => value)
          ),
        ]
      : []
  )
  const block: SlackDataVisualizationBlock = {
    type: 'data_visualization',
    title: clipText(input.title, LIMITS.title),
    chart: {
      type: 'line',
      series: [
        line(
          clipText(input.metric, LIMITS.label),
          runs.map((run) => Math.max(...run.map((p) => p.value)))
        ),
        ...thresholds,
      ],
      axis_config: {
        categories,
        x_label: 'UTC',
        y_label: clipText(input.unit ?? input.metric, LIMITS.axisLabel),
      },
    },
  }
  return validateDataVisualization(block).length === 0 ? block : null
}
