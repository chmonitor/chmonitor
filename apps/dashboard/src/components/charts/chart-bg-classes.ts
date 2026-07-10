/**
 * Static `bg-chart-N` class literals for `ProportionList` fallback fills.
 *
 * Listed as full literals (not a `bg-chart-${n}` template) so Tailwind's
 * content scanner emits them at build time — a runtime-constructed class name
 * would be stripped from the production bundle since Tailwind can't see it
 * statically.
 */
export const CHART_BG_CLASSES = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const
