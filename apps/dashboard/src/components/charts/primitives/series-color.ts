/**
 * Shared series-color arithmetic for chart primitives (area/bar/donut).
 *
 * Resolves a stable, distinct color for the series/category at `index`:
 * - an explicit `colors` list (CSS var names) is used directly while `index`
 *   is within its bounds
 * - otherwise cycle through the themed `--chart-1..--chart-N` CSS vars
 *   (`src/styles.css`)
 * - beyond the themed palette, fall back to golden-angle hue rotation so
 *   every extra series still gets a distinct, readable color instead of
 *   `var(--chart-14)` (undefined -> renders with no color)
 */

/** Number of defined `--chart-N` theme variables (src/styles.css). */
export const THEME_CHART_COLOR_COUNT = 13

export function seriesColorVar(index: number, colors?: string[]): string {
  if (colors && colors.length > 0) {
    if (index < colors.length) return `var(${colors[index]})`
  } else if (index < THEME_CHART_COLOR_COUNT) {
    return `var(--chart-${index + 1})`
  }
  // Golden-angle (137.508°) hue rotation keeps successive colors far apart.
  const hue = Math.round((index * 137.508) % 360)
  return `hsl(${hue} 70% 55%)`
}
