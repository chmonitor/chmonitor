/**
 * Slack's data_visualization block, as documented at
 * https://docs.slack.dev/reference/block-kit/blocks/data-visualization-block/
 * Slack draws it as a native chart. The demo page draws the same JSON.
 */

export interface ChartPoint {
  label: string
  value: number
}

export interface ChartSeries {
  name: string
  data: ChartPoint[]
}

export interface AxisConfig {
  /** The x-axis, left to right. Every series has one point per category. */
  categories: string[]
  x_label?: string
  y_label?: string
}

export interface PieChart {
  type: 'pie'
  segments: { label: string; value: number }[]
}

export interface AxisChart {
  type: 'bar' | 'area' | 'line'
  series: ChartSeries[]
  axis_config: AxisConfig
}

export type SlackChart = PieChart | AxisChart

export interface DataVisualizationBlock {
  type: 'data_visualization'
  title: string
  chart: SlackChart
  block_id?: string
}

/** The documented limits, in characters or items. */
const MAX = { title: 50, axisTitle: 50, label: 20, items: 12, points: 20 }

const AXIS_CHARTS = ['bar', 'area', 'line']

type Fail = (problem: string) => never

function record(value: unknown, path: string, fail: Fail) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} is required`)
  }
  return value as Record<string, unknown>
}

function onlyFields(
  value: Record<string, unknown>,
  known: string[],
  path: string,
  fail: Fail
) {
  const extra = Object.keys(value).find((k) => !known.includes(k))
  if (extra) fail(`${path} field "${extra}" is not drawn`)
}

function text(value: unknown, path: string, max: number, fail: Fail) {
  if (typeof value !== 'string' || value === '') fail(`${path} is required`)
  const s = value as string
  if (s.length > max) fail(`${path} is ${s.length} characters, max ${max}`)
  return s
}

function list(value: unknown, path: string, max: number, fail: Fail) {
  if (!Array.isArray(value)) fail(`${path} is required`)
  const items = value as unknown[]
  if (items.length < 1 || items.length > max) {
    fail(`${path} has ${items.length} items, needs 1 to ${max}`)
  }
  return items
}

function number(value: unknown, path: string, fail: Fail) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} is not a number`)
  }
  return value as number
}

function checkPie(chart: Record<string, unknown>, fail: Fail) {
  onlyFields(chart, ['type', 'segments'], 'chart', fail)
  list(chart.segments, 'chart.segments', MAX.items, fail).forEach((raw, i) => {
    const path = `chart.segments[${i}]`
    const segment = record(raw, path, fail)
    onlyFields(segment, ['label', 'value'], path, fail)
    text(segment.label, `${path}.label`, MAX.label, fail)
    if (number(segment.value, `${path}.value`, fail) <= 0) {
      fail(`${path}.value must be greater than 0`)
    }
  })
}

function checkAxisChart(chart: Record<string, unknown>, fail: Fail) {
  onlyFields(chart, ['type', 'series', 'axis_config'], 'chart', fail)
  const axis = record(chart.axis_config, 'chart.axis_config', fail)
  onlyFields(
    axis,
    ['categories', 'x_label', 'y_label'],
    'chart.axis_config',
    fail
  )
  for (const key of ['x_label', 'y_label']) {
    if (axis[key] !== undefined) {
      text(axis[key], `chart.axis_config.${key}`, MAX.axisTitle, fail)
    }
  }
  if (!Array.isArray(axis.categories))
    fail('chart.axis_config.categories is required')
  const categories = (axis.categories as unknown[]).map((c, i) =>
    text(c, `chart.axis_config.categories[${i}]`, MAX.label, fail)
  )
  const twice = categories.find((c, i) => categories.indexOf(c) !== i)
  if (twice !== undefined)
    fail(`chart.axis_config.categories has "${twice}" twice`)

  const names = new Set<string>()
  list(chart.series, 'chart.series', MAX.items, fail).forEach((raw, s) => {
    const path = `chart.series[${s}]`
    const series = record(raw, path, fail)
    onlyFields(series, ['name', 'data'], path, fail)
    const name = text(series.name, `${path}.name`, MAX.label, fail)
    if (names.has(name)) fail(`${path}.name "${name}" is used twice`)
    names.add(name)

    const seen = new Set<string>()
    list(series.data, `${path}.data`, MAX.points, fail).forEach(
      (rawPoint, p) => {
        const at = `${path}.data[${p}]`
        const point = record(rawPoint, at, fail)
        onlyFields(point, ['label', 'value'], at, fail)
        const label = text(point.label, `${at}.label`, MAX.label, fail)
        number(point.value, `${at}.value`, fail)
        if (!categories.includes(label)) {
          fail(`${at}.label "${label}" is not in axis_config.categories`)
        }
        if (seen.has(label)) fail(`${path}.data has two points for "${label}"`)
        seen.add(label)
      }
    )
    const missing = categories.find((c) => !seen.has(c))
    if (missing !== undefined)
      fail(`${path}.data has no point for "${missing}"`)
  })
}

/**
 * Check a block against every limit Slack documents, so the demo cannot draw
 * a chart Slack would refuse. Throws with the path of the first problem.
 */
export function validateDataVisualization(
  raw: unknown
): DataVisualizationBlock {
  const failIn =
    (where: string): Fail =>
    (problem) => {
      throw new Error(`Slack demo: data_visualization${where}: ${problem}`)
    }
  const block = record(raw, 'block', failIn(''))
  onlyFields(block, ['type', 'title', 'chart', 'block_id'], 'block', failIn(''))
  const title = text(block.title, 'title', MAX.title, failIn(''))
  const fail = failIn(` "${title}"`)
  const chart = record(block.chart, 'chart', fail)
  if (chart.type === 'pie') checkPie(chart, fail)
  else if (AXIS_CHARTS.includes(chart.type as string))
    checkAxisChart(chart, fail)
  else fail(`chart.type "${chart.type}" is not pie, bar, area or line`)
  return raw as DataVisualizationBlock
}
