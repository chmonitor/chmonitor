/**
 * Text charts for Slack (pure). Block Kit has no chart block, so an alert's
 * recent values are drawn as one line of Unicode bars inside a code span,
 * where every bar is one monospace cell.
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

/** Bucket by max so a short spike in a long series still shows. */
function downsample(values: readonly number[], width: number): number[] {
  if (values.length <= width) return [...values]
  return Array.from({ length: width }, (_, i) => {
    const start = Math.floor((i * values.length) / width)
    const end = Math.floor(((i + 1) * values.length) / width)
    return values.slice(start, end).reduce((a, b) => Math.max(a, b))
  })
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
