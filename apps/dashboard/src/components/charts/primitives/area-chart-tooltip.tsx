import type { ChartConfig } from '@/components/ui/chart'

import { BreakdownSection } from './tooltip-breakdown-section'
import { parseBreakdownData } from './tooltip-data-parser'
import { StandardTooltipRow, SummaryRow } from './tooltip-row'
import { ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

/** Raw data row backing a tooltip (Recharts passes the row object as `payload`). */
type TooltipDataRecord = Record<string, unknown>

export interface RenderChartTooltipOptions {
  breakdown?: string
  breakdownLabel?: string
  breakdownValue?: string
  breakdownHeading?: string
  tooltipActive?: boolean
  chartConfig: ChartConfig
  categories: string[]
}

export function renderChartTooltip({
  breakdown,
  breakdownLabel,
  breakdownValue,
  breakdownHeading,
  chartConfig,
  categories,
}: RenderChartTooltipOptions) {
  if (!breakdown) {
    return renderStandardTooltip(chartConfig)
  }

  if (categories.length > 1) {
    throw new Error('Only support single category for breakdown')
  }

  return renderBreakdownTooltip({
    breakdown,
    breakdownLabel,
    breakdownValue,
    breakdownHeading,
    chartConfig,
  })
}

function renderStandardTooltip(chartConfig: ChartConfig) {
  return (
    <ChartTooltip
      cursor
      wrapperStyle={{ zIndex: 1000 }}
      content={
        <ChartTooltipContent
          className="max-w-[300px] [font-variant-numeric:tabular-nums]"
          formatter={(value, name, item, index) => {
            return (
              <StandardTooltipRow
                key={`${name}${index}`}
                name={name as string}
                value={value}
                item={item}
                chartConfig={chartConfig}
              />
            )
          }}
        />
      }
    />
  )
}

function renderBreakdownTooltip({
  breakdown,
  breakdownLabel,
  breakdownValue,
  breakdownHeading,
  chartConfig,
}: {
  breakdown?: string
  breakdownLabel?: string
  breakdownValue?: string
  breakdownHeading?: string
  chartConfig: ChartConfig
}) {
  return (
    <ChartTooltip
      content={
        <ChartTooltipContent
          className="max-w-[320px] [font-variant-numeric:tabular-nums]"
          formatter={(value, name, item, _index, payload) => {
            return (
              <BreakdownTooltipContent
                name={name as string}
                value={value}
                item={item}
                payload={payload as unknown as TooltipDataRecord}
                breakdown={breakdown}
                breakdownLabel={breakdownLabel}
                breakdownValue={breakdownValue}
                breakdownHeading={breakdownHeading}
                chartConfig={chartConfig}
              />
            )
          }}
        />
      }
      cursor={false}
    />
  )
}

function BreakdownTooltipContent({
  name,
  value,
  item,
  payload,
  breakdown,
  breakdownLabel,
  breakdownValue,
  breakdownHeading,
  chartConfig,
}: {
  name: string
  value: unknown
  item: unknown
  payload: TooltipDataRecord
  breakdown?: string
  breakdownLabel?: string
  breakdownValue?: string
  breakdownHeading?: string
  chartConfig: ChartConfig
}) {
  const breakdownDataMap = parseBreakdownData(
    payload[breakdown as string] as Array<unknown>,
    breakdownLabel,
    breakdownValue
  )

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <SummaryRow name={name} value={value} chartConfig={chartConfig} />

      {breakdownDataMap.length > 0 && (
        <BreakdownSection
          breakdownData={breakdownDataMap}
          heading={breakdownHeading || 'Breakdown'}
          item={item}
          breakdownLabel={breakdownLabel}
        />
      )}
    </div>
  )
}

export function PinnedBreakdownTooltip({
  data,
  category,
  breakdown,
  breakdownLabel,
  breakdownValue,
  breakdownHeading,
  chartConfig,
}: {
  data: Record<string, unknown>
  category: string
  breakdown?: string
  breakdownLabel?: string
  breakdownValue?: string
  breakdownHeading?: string
  chartConfig: ChartConfig
}) {
  return (
    <div className="recharts-tooltip-wrapper">
      <BreakdownTooltipContent
        name={category}
        value={data[category]}
        item={{ payload: data }}
        payload={data}
        breakdown={breakdown}
        breakdownLabel={breakdownLabel}
        breakdownValue={breakdownValue}
        breakdownHeading={breakdownHeading}
        chartConfig={chartConfig}
      />
    </div>
  )
}
