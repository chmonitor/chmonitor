/**
 * Declarative chart loader (plans/58-declarative-chart-schema.md).
 *
 * Converts a validated DeclarativeChart into the exact config object the
 * existing chart factories (`createAreaChart` / `createBarChart`) accept, and
 * — via `createChartFromDeclarative` — straight into a rendered chart
 * component. There is no separate declarative rendering pipeline: a
 * declarative chart is a data description of the SAME factory call a
 * hand-authored chart file makes.
 *
 * RUNTIME-ONLY / CATALOG-ONLY FIELDS NOT PRESENT ON THE LOADED FACTORY CONFIG:
 *   - description, icon — catalog metadata (docs / future chart-picker UI);
 *     the factories have no such prop today. Read them off the declarative
 *     definition directly (see `DeclarativeChart['description' | 'icon']`).
 *
 * Compiled fields (declarative spec → runtime value on the loaded config):
 *   - areaChartProps.yAxisTickFormatterKey / barChartProps.yAxisTickFormatterKey
 *     → the matching function from `lib/utils.ts#chartTickFormatters`.
 */

import type { FC } from 'react'
import type { ChartProps } from '@/components/charts/chart-props'
import type {
  AreaChartFactoryConfig,
  BarChartFactoryConfig,
} from '@/components/charts/factory'
import type {
  DeclarativeAreaChart,
  DeclarativeAreaChartProps,
  DeclarativeBarChart,
  DeclarativeBarChartProps,
  TickFormatterKey,
} from './schema'

import { validateDeclarativeChart } from './validate'
import { createAreaChart, createBarChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

function resolveTickFormatter(key: TickFormatterKey | undefined) {
  return key === undefined ? undefined : chartTickFormatters[key]
}

function buildAreaChartProps(
  props: DeclarativeAreaChartProps | undefined
): AreaChartFactoryConfig['areaChartProps'] {
  if (!props) return undefined

  const { yAxisTickFormatterKey, ...rest } = props
  const yAxisTickFormatter = resolveTickFormatter(yAxisTickFormatterKey)

  return {
    ...rest,
    ...(yAxisTickFormatter !== undefined ? { yAxisTickFormatter } : {}),
  }
}

function buildBarChartProps(
  props: DeclarativeBarChartProps | undefined
): BarChartFactoryConfig['barChartProps'] {
  if (!props) return undefined

  const { yAxisTickFormatterKey, ...rest } = props
  const yAxisTickFormatter = resolveTickFormatter(yAxisTickFormatterKey)

  return {
    ...rest,
    ...(yAxisTickFormatter !== undefined ? { yAxisTickFormatter } : {}),
  }
}

/** Build an `AreaChartFactoryConfig` from a validated declarative area chart. */
export function buildAreaChartConfig(
  d: DeclarativeAreaChart
): AreaChartFactoryConfig {
  const config: AreaChartFactoryConfig = {
    chartName: d.chartName,
    index: d.index,
    categories: d.categories,
  }

  if (d.defaultTitle !== undefined) config.defaultTitle = d.defaultTitle
  if (d.defaultInterval !== undefined)
    config.defaultInterval = d.defaultInterval
  if (d.defaultLastHours !== undefined)
    config.defaultLastHours = d.defaultLastHours
  if (d.refreshInterval !== undefined)
    config.refreshInterval = d.refreshInterval
  if (d.dataTestId !== undefined) config.dataTestId = d.dataTestId
  if (d.dateRangeConfig !== undefined)
    config.dateRangeConfig = d.dateRangeConfig
  if (d.enableScaleToggle !== undefined)
    config.enableScaleToggle = d.enableScaleToggle
  if (d.defaultChartClassName !== undefined)
    config.defaultChartClassName = d.defaultChartClassName
  if (d.showDeployments !== undefined)
    config.showDeployments = d.showDeployments

  const areaChartProps = buildAreaChartProps(d.areaChartProps)
  if (areaChartProps !== undefined) config.areaChartProps = areaChartProps

  return config
}

/** Build a `BarChartFactoryConfig` from a validated declarative bar chart. */
export function buildBarChartConfig(
  d: DeclarativeBarChart
): BarChartFactoryConfig {
  const config: BarChartFactoryConfig = {
    chartName: d.chartName,
    index: d.index,
    categories: d.categories,
  }

  if (d.defaultTitle !== undefined) config.defaultTitle = d.defaultTitle
  if (d.defaultInterval !== undefined)
    config.defaultInterval = d.defaultInterval
  if (d.defaultLastHours !== undefined)
    config.defaultLastHours = d.defaultLastHours
  if (d.refreshInterval !== undefined)
    config.refreshInterval = d.refreshInterval
  if (d.dataTestId !== undefined) config.dataTestId = d.dataTestId
  if (d.dateRangeConfig !== undefined)
    config.dateRangeConfig = d.dateRangeConfig
  if (d.enableScaleToggle !== undefined)
    config.enableScaleToggle = d.enableScaleToggle
  if (d.defaultChartClassName !== undefined)
    config.defaultChartClassName = d.defaultChartClassName
  if (d.xAxisDateFormat !== undefined)
    config.xAxisDateFormat = d.xAxisDateFormat

  const barChartProps = buildBarChartProps(d.barChartProps)
  if (barChartProps !== undefined) config.barChartProps = barChartProps

  return config
}

export type LoadedDeclarativeChart =
  | { kind: 'area'; config: AreaChartFactoryConfig }
  | { kind: 'bar'; config: BarChartFactoryConfig }

/**
 * Validate `input` against the declarative chart schema (throws on invalid)
 * and compile it into the matching `*ChartFactoryConfig`, tagged with which
 * factory it targets.
 *
 * @throws Error when `input` fails schema validation (message includes all
 *   field-level errors joined by '; ').
 */
export function loadDeclarativeChart(input: unknown): LoadedDeclarativeChart {
  const result = validateDeclarativeChart(input)
  if (!result.ok) {
    throw new Error(`Invalid declarative chart: ${result.errors.join('; ')}`)
  }

  const d = result.chart
  return d.type === 'area'
    ? { kind: 'area', config: buildAreaChartConfig(d) }
    : { kind: 'bar', config: buildBarChartConfig(d) }
}

/**
 * Load a declarative chart definition and hand it straight to the matching
 * factory (`createAreaChart` / `createBarChart`), returning the same
 * `FC<ChartProps>` a hand-authored `createAreaChart({...})` call would — the
 * declarative catalog renders through the exact same factory code path as
 * every other chart, with zero rendering-pipeline duplication.
 */
export function createChartFromDeclarative(input: unknown): FC<ChartProps> {
  const loaded = loadDeclarativeChart(input)
  return loaded.kind === 'area'
    ? createAreaChart(loaded.config)
    : createBarChart(loaded.config)
}
