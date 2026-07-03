/**
 * Declarative chart schema — the catalog contract (plans/58-declarative-chart-schema.md).
 *
 * Mirrors `lib/query-config/declarative/schema.ts`: this module defines the
 * SERIALIZABLE subset of a chart's factory config that can live in a JSON /
 * YAML / TOML file and be authored by the community (or an AI agent) without
 * writing TypeScript.
 *
 * A declarative chart definition maps 1:1 onto the config object the two
 * "pure" chart factories already accept — `createAreaChart` and
 * `createBarChart` (see `../factory/create-area-chart.tsx` /
 * `../factory/create-bar-chart.tsx` / `../factory/types.ts`). The companion
 * `loader.ts` compiles a validated definition into that exact config object
 * (or, via `createChartFromDeclarative`, straight into a rendered chart
 * component) — so a declarative chart renders through the SAME factory code
 * path as a hand-authored one. No parallel rendering pipeline.
 *
 * `createCustomChart` (bespoke `render(data) => ReactNode` charts — progress
 * bars, proportion lists, metric tiles, …) is intentionally NOT covered here:
 * `render` is a function reference, not serializable. Charts that need that
 * level of bespoke layout stay TS-only; this schema only expresses the
 * data-describable area/bar chart shape. This mirrors the query-config
 * declarative schema's philosophy of excluding runtime-only fields (functions,
 * live component refs) rather than smuggling them in as opaque blobs.
 *
 * Serializable fields carried here:
 *   identity:    chartName (chart-registry query key), description, icon
 *   presentation: type ('area' | 'bar'), index, categories, defaultTitle
 *   time:        defaultInterval, defaultLastHours, dateRangeConfig
 *   behavior:    refreshInterval, enableScaleToggle, dataTestId
 *   area-only:   showDeployments, areaChartProps (colors/stack/readable/…)
 *   bar-only:    xAxisDateFormat, barChartProps (colors/stack/layout/…)
 *
 * Intentionally excluded (not serializable — require runtime code):
 *   render               — CustomChartFactoryConfig's function (use a TS chart)
 *   categories as fn     — BarChartFactoryConfig also allows
 *                          `(data) => string[]`; the declarative form only
 *                          supports a static string[]
 *   tickFormatter / valueFormatter / customTooltip / onValueChange / chartConfig
 *                        — function/JSX values on AreaChartProps/BarChartProps.
 *                          `yAxisTickFormatterKey` covers the common case by
 *                          referencing a named formatter from
 *                          `lib/utils.ts#chartTickFormatters`.
 *   dateRangeConfig as a literal DateRangeConfig object — only the named
 *                          presets (`DateRangePresetName`) are supported
 *                          declaratively; a bespoke options array stays TS-only.
 */

import { z } from 'zod'

import { isKnownChartIconName } from './icon'

// ---------------------------------------------------------------------------
// ClickHouseInterval — mirrors VALID_INTERVALS from
// @chm/types/clickhouse-interval. Hardcoded here (not imported) to keep the
// declarative chart schema decoupled from app code, matching the
// query-config declarative schema's convention (see featureIdSchema there).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DateRangePresetName — mirrors the keys of DATE_RANGE_PRESETS from
// components/date-range/date-range-presets.ts. Hardcoded for the same reason
// as clickHouseIntervalValues above.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// yAxisTickFormatterKey — named reference into chartTickFormatters (lib/utils.ts)
// ---------------------------------------------------------------------------

const tickFormatterKeyValues = [
  'bytes',
  'percentage',
  'count',
  'duration',
  'default',
] as const

export const tickFormatterKeySchema = z.enum(tickFormatterKeyValues)
export type TickFormatterKey = z.infer<typeof tickFormatterKeySchema>

// ---------------------------------------------------------------------------
// readable / yAxisScale — small string enums shared by area + bar props
// ---------------------------------------------------------------------------

const readableFormatSchema = z.enum(['bytes', 'duration', 'number', 'quantity'])
const yAxisScaleSchema = z.enum(['linear', 'log', 'auto'])

// ---------------------------------------------------------------------------
// icon — lucide-react icon name (kebab-case), resolved lazily by ../icon.tsx.
// Not embedded into the factory config (the factory has no icon prop today);
// this is catalog metadata for a future chart picker / docs / AI authoring
// surface. Validated against lucide-react's own icon-name list so a typo'd
// icon fails at catalog-validation time rather than silently rendering nothing.
// ---------------------------------------------------------------------------

const chartIconSchema = z
  .string()
  .min(1)
  .refine(isKnownChartIconName, {
    message: 'icon must be a valid lucide-react icon name (kebab-case)',
  })
  .optional()

// ---------------------------------------------------------------------------
// areaChartProps — serializable subset of AreaChartProps
// (types/charts.ts) + the factory's yAxisTickFormatter extension.
// ---------------------------------------------------------------------------

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
  // Compiled by the loader into `areaChartProps.yAxisTickFormatter`.
  yAxisTickFormatterKey: tickFormatterKeySchema.optional(),
})

export type DeclarativeAreaChartProps = z.infer<
  typeof declarativeAreaChartPropsSchema
>

// ---------------------------------------------------------------------------
// barChartProps — serializable subset of BarChartProps (types/charts.ts) +
// the factory's yAxisTickFormatter extension.
// ---------------------------------------------------------------------------

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
  // Compiled by the loader into `barChartProps.yAxisTickFormatter`.
  yAxisTickFormatterKey: tickFormatterKeySchema.optional(),
})

export type DeclarativeBarChartProps = z.infer<
  typeof declarativeBarChartPropsSchema
>

// ---------------------------------------------------------------------------
// Shared base fields (BaseChartFactoryConfig subset)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Area chart definition
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Bar chart definition
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main declarative schema — discriminated union on `type`
// ---------------------------------------------------------------------------

export const declarativeChartSchema = z.discriminatedUnion('type', [
  declarativeAreaChartSchema,
  declarativeBarChartSchema,
])

export type DeclarativeChart = z.infer<typeof declarativeChartSchema>
