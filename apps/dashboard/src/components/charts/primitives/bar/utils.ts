/**
 * Bar chart utility functions
 */

import type { ChartConfig } from '@/components/ui/chart'

import { seriesColorVar } from '@/components/charts/primitives/series-color'

/**
 * Sanitize a category name for use as a CSS variable name.
 * CSS custom properties cannot contain parentheses, brackets, or most special chars.
 * Example: "(empty)" -> "empty", "user@domain" -> "user-domain"
 */
export function sanitizeCssVarName(name: string): string {
  return (
    name
      .replace(/[()[\]{}]/g, '') // Remove brackets/parens
      .replace(/[^a-zA-Z0-9_-]/g, '-') // Replace other special chars with dash
      .replace(/^-+|-+$/g, '') // Trim leading/trailing dashes
      .replace(/-+/g, '-') || // Collapse multiple dashes
    'unnamed'
  ) // Fallback for empty result
}

/**
 * Sort categories by their total values across all data points.
 * Returns categories in ascending order (smallest first = bottom of stack).
 * This ensures larger segments appear on top of stacked bars.
 */
export function sortCategoriesByTotal<T extends Record<string, unknown>>(
  data: T[],
  categories: string[]
): string[] {
  // Calculate total for each category
  const totals = categories.map((category) => ({
    category,
    total: data.reduce((sum, row) => {
      const value = row[category]
      return sum + (typeof value === 'number' ? value : 0)
    }, 0),
  }))

  // Sort ascending (smallest first = bottom, largest last = top)
  totals.sort((a, b) => a.total - b.total)

  return totals.map((t) => t.category)
}

/**
 * Resolve a stable, distinct color for the category at `index`.
 *
 * Delegates to the shared {@link seriesColorVar} helper so bar charts use the
 * same arithmetic as the area/donut primitives (all 13 themed `--chart-N`
 * vars, then golden-angle hue rotation for series beyond that).
 */
export function colorForCategoryIndex(
  index: number,
  colors?: string[]
): string {
  return seriesColorVar(index, colors)
}

/**
 * Generates chart configuration for bar categories
 * Maps each category to a color from the provided palette.
 *
 * Uses sanitized category names as keys to ensure valid CSS variable names.
 * The original category name is preserved in the label for display.
 */
export function generateChartConfig(
  categories: string[],
  colors?: string[],
  colorLabel?: string
): ChartConfig {
  return categories.reduce(
    (acc, category, index) => {
      const sanitizedKey = sanitizeCssVarName(category)
      acc[sanitizedKey] = {
        label: category, // Original name for display in tooltips/legends
        color: colorForCategoryIndex(index, colors),
      }

      return acc
    },
    {
      label: {
        color: colorLabel ? `var(${colorLabel})` : 'var(--background)',
      },
    } as ChartConfig
  )
}

/**
 * Radius calculation options for bar corners
 */
export interface BarRadiusOptions {
  index: number
  categories: string[]
  stack: boolean
  horizontal: boolean
  radius?: number
}

/**
 * Calculates bar corner radius based on position and layout
 *
 * For stacked bars: only the topmost segment gets rounded top corners.
 * For non-stacked bars: top corners (or right corners for horizontal) get rounded.
 *
 * Recharts radius tuple: [topLeft, topRight, bottomRight, bottomLeft]
 */
export function getBarRadius({
  index,
  categories,
  stack,
  horizontal,
  radius = 4,
}: BarRadiusOptions): number | [number, number, number, number] {
  const isLastCategory = index === categories.length - 1

  if (stack) {
    // Only the topmost segment (last in array) gets rounded corners
    if (!isLastCategory) {
      return 0
    }
  }

  // Vertical bars: round top corners [topLeft, topRight, bottomRight, bottomLeft]
  // Horizontal bars: round right corners (the "end" of the bar)
  if (horizontal) {
    return [0, radius, radius, 0]
  }

  return [radius, radius, 0, 0]
}
