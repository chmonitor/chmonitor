/**
 * Declarative chart schema: the serializable subset of a chart's factory
 * config that can live in JSON/YAML and be authored without TypeScript.
 *
 * A definition maps 1:1 onto the config `createAreaChart` / `createBarChart`
 * accept; `loader.ts` compiles it, so it renders through the same factory
 * path as a hand-authored chart.
 *
 * Not serializable, so TS-only: `createCustomChart` (`render` is a function),
 * `categories` as a function, formatter/tooltip/JSX props (use
 * `yAxisTickFormatterKey` for named formatters from
 * `lib/utils.ts#chartTickFormatters`), and literal DateRangeConfig objects
 * (only named `DateRangePresetName` presets are supported).
 */

import { z } from 'zod'

import { isKnownChartIconName } from './icon'

// ClickHouseInterval — mirrors VALID_INTERVALS from
// @chm/types/clickhouse-interval. Hardcoded here (not imported) to keep the
// declarative chart schema decoupled from app code, matching the
// query-config declarative schema's convention (see featureIdSchema there).

const clickHouseIntervalValues = [
  'toStartOfMinute',
  'toStartOfFiveMinutes',
  'toStartOfTenMinutes',
  'toStartOfFifteenMinutes',
  'toStartOfHour',
  'toStartOfDay',
  'toStartOfWeek',
  'toStartOfMonth',
] as const

const clickHouseIntervalSchema = z.enum(clickHouseIntervalValues)

// DateRangePresetName — mirrors the keys of DATE_RANGE_PRESETS from
// components/date-range/date-range-presets.ts. Hardcoded for the same reason
// as clickHouseIntervalValues above.

const dateRangePresetNameValues = [
  'standard',
  'realtime',
  'historical',
  'disk-usage',
  'query-activity',
  'query-duration',
  'system-metrics',
  'operations',
  'health',
  'page-views',
  'insights',
] as const

const dateRangePresetNameSchema = z.enum(dateRangePresetNameValues)

// yAxisTickFormatterKey — named reference into chartTickFormatters (lib/utils.ts)

const tickFormatterKeyValues = [
  'bytes',
  'percentage',
  'count',
  'duration',
  'default',
] as const

export const tickFormatterKeySchema = z.enum(tickFormatterKeyValues)
export type TickFormatterKey = z.infer<typeof tickFormatterKeySchema>

// readable / yAxisScale — small string enums shared by area + bar props

const readableFormatSchema = z.enum(['bytes', 'duration', 'number', 'quantity'])
const yAxisScaleSchema = z.enum(['linear', 'log', 'auto'])

// icon — lucide-react icon name (kebab-case), resolved lazily by ../icon.tsx.
// Not embedded into the factory config (the factory has no icon prop today);
// this is catalog metadata for a future chart picker / docs / AI authoring
// surface. Validated against lucide-react's own icon-name list so a typo'd
// icon fails at catalog-validation time rather than silently rendering nothing.

const chartIconSchema = z
  .string()
  .min(1)
  .refine(isKnownChartIconName, {
    message: 'icon must be a valid lucide-react icon name (kebab-case)',
  })
  .optional()

// areaChartProps — serializable subset of AreaChartProps
// (types/charts.ts) + the factory's yAxisTickFormatter extension.

export const declarativeAreaChartPropsSchema = z.object({
  colors: z.array(z.string().min(1)).optional(),
  stack: z.boolean().optional(),
  relative: z.boolean().optional(),
  opacity: z.number().optional(),
  breakdown: z.string().optional(),
  breakdownLabel: z.string().optional(),
  breakdownValue: z.string().optional(),
  breakdownHeading: z.string().optional(),
  showLegend: z.boolean().optional(),
  showXAxis: z.boolean().optional(),
  showYAxis: z.boolean().optional(),
  showTooltip: z.boolean().optional(),
  showCartesianGrid: z.boolean().optional(),
  showGridLines: z.boolean().optional(),
  startEndOnly: z.boolean().optional(),
  readable: readableFormatSchema.optional(),
  readableColumn: z.string().optional(),
  readableColumns: z.array(z.string()).optional(),
  yAxisScale: yAxisScaleSchema.optional(),
  yAxisWidth: z.number().optional(),
  tickGap: z.number().optional(),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
  yAxisTickFormatterKey: tickFormatterKeySchema.optional(),
})

export type DeclarativeAreaChartProps = z.infer<
  typeof declarativeAreaChartPropsSchema
>

// barChartProps — serializable subset of BarChartProps (types/charts.ts) +
// the factory's yAxisTickFormatter extension.

export const declarativeBarChartPropsSchema = z.object({
  colors: z.array(z.string().min(1)).optional(),
  stack: z.boolean().optional(),
  relative: z.boolean().optional(),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  horizontal: z.boolean().optional(),
  barCategoryGap: z.union([z.string(), z.number()]).optional(),
  readableColumn: z.string().optional(),
  tooltipTotal: z.boolean().optional(),
  yAxisScale: yAxisScaleSchema.optional(),
  showLegend: z.boolean().optional(),
  showXAxis: z.boolean().optional(),
  showYAxis: z.boolean().optional(),
  showTooltip: z.boolean().optional(),
  showGridLines: z.boolean().optional(),
  yAxisTickFormatterKey: tickFormatterKeySchema.optional(),
})

export type DeclarativeBarChartProps = z.infer<
  typeof declarativeBarChartPropsSchema
>

// Shared base fields (BaseChartFactoryConfig subset)

const declarativeChartBaseSchema = z.object({
  // Identity — the key this chart's data is fetched under, via
  // GET /api/v1/charts/$chartName. Must already be registered in the
  // server-side chart-registry (lib/api/chart-registry.ts); the declarative
  // schema describes PRESENTATION only, not the SQL behind the chart.
  chartName: z.string().min(1, 'chartName is required'),
  description: z.string().optional(),
  icon: chartIconSchema,

  defaultTitle: z.string().optional(),
  defaultInterval: clickHouseIntervalSchema.optional(),
  defaultLastHours: z.number().positive().optional(),
  refreshInterval: z.number().positive().optional(),
  dataTestId: z.string().optional(),
  dateRangeConfig: dateRangePresetNameSchema.optional(),
  enableScaleToggle: z.boolean().optional(),
})

export const declarativeAreaChartSchema = declarativeChartBaseSchema.extend({
  type: z.literal('area'),
  index: z.string().min(1, 'index is required'),
  categories: z
    .array(z.string().min(1))
    .min(1, 'categories must have at least one entry'),
  defaultChartClassName: z.string().optional(),
  /** Opt-in GitHub deploy-marker overlay (plans/45-github-deploy-correlation.md). */
  showDeployments: z.boolean().optional(),
  areaChartProps: declarativeAreaChartPropsSchema.optional(),
})

export type DeclarativeAreaChart = z.infer<typeof declarativeAreaChartSchema>

export const declarativeBarChartSchema = declarativeChartBaseSchema.extend({
  type: z.literal('bar'),
  index: z.string().min(1, 'index is required'),
  // BarChartFactoryConfig also allows `categories: (data) => string[]` — not
  // serializable, so the declarative form only supports a static list.
  categories: z
    .array(z.string().min(1))
    .min(1, 'categories must have at least one entry'),
  defaultChartClassName: z.string().optional(),
  xAxisDateFormat: z.boolean().optional(),
  barChartProps: declarativeBarChartPropsSchema.optional(),
})

export type DeclarativeBarChart = z.infer<typeof declarativeBarChartSchema>

// Main declarative schema — discriminated union on `type`

export const declarativeChartSchema = z.discriminatedUnion('type', [
  declarativeAreaChartSchema,
  declarativeBarChartSchema,
])

export type DeclarativeChart = z.infer<typeof declarativeChartSchema>
