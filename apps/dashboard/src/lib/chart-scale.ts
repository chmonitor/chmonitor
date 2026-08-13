import type { YAxisScale } from '@/types/charts'

/**
 * Threshold for auto-detecting log scale
 * If max/min ratio exceeds this, log scale is recommended
 */
const LOG_SCALE_THRESHOLD = 100

/**
 * Minimum positive value to use for log scale domain
 * Values at or below zero will be treated as this value
 */
export const LOG_SCALE_MIN = 1

/**
 * Analyze data to determine if log scale is appropriate
 *
 * @param data - Array of data points
 * @param categories - Category keys to analyze
 * @returns Analysis result with recommendation and domain
 */
export function analyzeDataForLogScale(
  data: Record<string, unknown>[],
  categories: string[]
): {
  shouldUseLog: boolean
  minValue: number
  maxValue: number
  ratio: number
  hasZeroOrNegative: boolean
} {
  let minPositive = Infinity
  let maxValue = -Infinity
  let hasZeroOrNegative = false

  for (const point of data) {
    for (const category of categories) {
      const value = point[category]
      if (typeof value === 'number' && !Number.isNaN(value)) {
        maxValue = Math.max(maxValue, value)
        if (value > 0) {
          minPositive = Math.min(minPositive, value)
        } else {
          hasZeroOrNegative = true
        }
      }
    }
  }

  // Handle edge cases: no positive values (all zero/negative) or no numeric
  // values at all. Report the actual accumulated hasZeroOrNegative so all-zero/
  // negative input is not mislabelled as false.
  if (minPositive === Infinity || maxValue === -Infinity) {
    return {
      shouldUseLog: false,
      minValue: 0,
      maxValue: 0,
      ratio: 1,
      hasZeroOrNegative,
    }
  }

  const ratio = maxValue / minPositive
  const shouldUseLog = ratio >= LOG_SCALE_THRESHOLD && maxValue > 0

  return {
    shouldUseLog,
    minValue: minPositive,
    maxValue,
    ratio,
    hasZeroOrNegative,
  }
}

/**
 * Resolve scale type based on data and configuration
 *
 * @param scale - Configured scale type
 * @param data - Chart data
 * @param categories - Category keys to analyze
 * @returns 'linear' | 'log' for Recharts
 */
export function resolveYAxisScale(
  scale: YAxisScale | undefined,
  data: Record<string, unknown>[],
  categories: string[]
): 'linear' | 'log' {
  if (!scale || scale === 'linear') {
    return 'linear'
  }

  if (scale === 'log') {
    return 'log'
  }

  // Auto-detect
  if (scale === 'auto') {
    const analysis = analyzeDataForLogScale(data, categories)
    return analysis.shouldUseLog ? 'log' : 'linear'
  }

  return 'linear'
}

/**
 * Get appropriate Y-axis domain for log scale
 * Log scale requires positive values, so we need to set a minimum
 *
 * @param data - Chart data
 * @param categories - Category keys to analyze
 * @param isLogScale - Whether log scale is being used
 * @returns Domain tuple [min, max] for Recharts
 */
export function getYAxisDomain(
  _data: Record<string, unknown>[],
  _categories: string[],
  isLogScale: boolean
): [number | 'auto', number | 'auto'] {
  if (!isLogScale) {
    return ['auto', 'auto']
  }

  // For log scale, always use LOG_SCALE_MIN (1) as the domain minimum
  // This ensures area charts fill all the way to the bottom
  return [LOG_SCALE_MIN, 'auto']
}

/**
 * Floor zero/negative category values to LOG_SCALE_MIN for log-scale rendering.
 *
 * Log scale cannot represent zero or negative values (log(0) is undefined),
 * so Recharts maps those points to `null`. On an Area chart that breaks the
 * filled polygon into disconnected slivers around every zero/negative point
 * instead of one continuous shape — the area effectively disappears and only
 * the stroke on the surviving points remains visible. Per LOG_SCALE_MIN's
 * contract ("values at or below zero are treated as this value"), clamp
 * those values to the domain floor before they reach the chart so every
 * point stays finite and the area renders as a continuous fill.
 *
 * @param data - Chart data rows
 * @param categories - Category keys to clamp
 * @returns A new array with clamped values; rows needing no change are
 *   returned unmodified (reference-equal) to avoid unnecessary copies.
 *
 * Note: this does not help the bottom-most series of a *stacked* Area chart.
 * Recharts derives a stacked series' baseline from the cumulative stack sum,
 * which always starts at 0 regardless of the (clamped) data values — that
 * baseline bypasses `baseValue`/data entirely, so it stays unmappable on a
 * log axis. Log scale + `stack` together is a structural limitation, not
 * something this function can paper over.
 */
export function clampDataForLogScale(
  data: Record<string, unknown>[],
  categories: string[]
): Record<string, unknown>[] {
  return data.map((point) => {
    let clamped: Record<string, unknown> | undefined
    for (const category of categories) {
      const value = point[category]
      if (typeof value === 'number' && Number.isFinite(value) && value <= 0) {
        clamped ??= { ...point }
        clamped[category] = LOG_SCALE_MIN
      }
    }
    return clamped ?? point
  })
}
