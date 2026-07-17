'use client'

import { BarChart3Icon, DownloadIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'
import type { AgentVisualizationProps, ChartType } from './types'

import { ChartControls } from './chart-controls'
import {
  BarChartView,
  ChartLoadingSkeleton,
  ComboChartView,
  EmptyDataMessage,
} from './charts'
import { CHART_TYPE_LABELS, isNumericColumn, sortRows } from './types'
import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { DataTable } from '@/components/data-table/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { exportToCsv } from '@/lib/agent-export'
import { cn } from '@/lib/utils'

export type { AgentVisualizationProps, VizConfig } from './types'

// Stable empty context object — avoids new reference on every render which
// would defeat column-def memoization inside DataTable.
const EMPTY_TABLE_CONTEXT: Record<string, string> = {}

// ============================================================================
// Lazy-loaded chart primitives
// ============================================================================

const AreaChartPrimitive = lazy(() =>
  import('@/components/charts/primitives/area').then((m) => ({
    default: m.AreaChart,
  }))
)

const DonutChart = lazy(() =>
  import('@/components/charts/primitives/donut').then((m) => ({
    default: m.DonutChart,
  }))
)

const NumberChart = lazy(() =>
  import('@/components/charts/primitives/number').then((m) => ({
    default: m.NumberChart,
  }))
)

const RadialChartPrimitive = lazy(() =>
  import('@/components/charts/primitives/radial').then((m) => ({
    default: m.RadialChart,
  }))
)

const BarListPrimitive = lazy(() =>
  import('@/components/charts/primitives/bar-list').then((m) => ({
    default: m.BarList,
  }))
)

const ScatterChartPrimitive = lazy(() =>
  import('@/components/charts/primitives/scatter').then((m) => ({
    default: m.ScatterChartPrimitive,
  }))
)

/**
 * AgentVisualization renders tool query results with interactive chart and
 * data/query tabs. Supports bar, line, area, pie, number, and table views.
 */
export function AgentVisualization({
  title,
  sql,
  rows,
  columns,
  rowCount,
  viz,
  className,
}: AgentVisualizationProps) {
  const [activeTab, setActiveTab] = useState<'chart' | 'data' | 'query'>(
    'chart'
  )
  const [chartType, setChartType] = useState<ChartType>(viz.chartType)
  const [xKey, setXKey] = useState<string>(viz.xKey)
  const [yKeys, setYKeys] = useState<string[]>(viz.yKeys)
  const [sortBy, setSortBy] = useState<string | undefined>(viz.sortBy)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(
    viz.sortOrder
  )
  const [numberRowIndex, setNumberRowIndex] = useState(0)
  const [stacked, setStacked] = useState(false)
  const [logScale, setLogScale] = useState(false)
  const [rightAxisKeys, setRightAxisKeys] = useState<Set<string>>(new Set())

  // Derive numeric columns from rows sample
  const numericColumns = useMemo(
    () => columns.filter((col) => isNumericColumn(rows, col)),
    [columns, rows]
  )

  // Sorted data for chart rendering
  const sortedRows = useMemo(
    () => sortRows(rows, sortBy, sortOrder),
    [rows, sortBy, sortOrder]
  )

  // QueryConfig for DataTable
  const queryConfig = useMemo<QueryConfig<string[]>>(
    () => ({
      name: 'agent-viz-result',
      description: title ?? 'Query results from AI agent',
      sql,
      columns: columns as string[],
    }),
    [title, sql, columns]
  )

  const handleSortChange = useCallback((val: string) => {
    if (val === '__none__') {
      setSortBy(undefined)
      setSortOrder(undefined)
    } else {
      const [col, order] = val.split(':')
      setSortBy(col)
      setSortOrder(order as 'asc' | 'desc')
    }
  }, [])

  const handleYKeyChange = useCallback((val: string) => {
    setYKeys([val])
  }, [])

  const handleDownload = useCallback(() => {
    exportToCsv(
      sortedRows,
      title ? `${title.replace(/\s+/g, '-').toLowerCase()}.csv` : undefined
    )
  }, [sortedRows, title])

  const hasData = rows.length > 0

  const renderChart = () => {
    if (!hasData) return <EmptyDataMessage />

    try {
      if (chartType === 'table') {
        return (
          <DataTable
            data={rows.slice(0, 100) as Record<string, unknown>[]}
            queryConfig={queryConfig}
            context={EMPTY_TABLE_CONTEXT}
            defaultPageSize={Math.min(rows.length, 25)}
            showSQL={false}
            enableColumnFilters={false}
            enableColumnReordering={false}
            compact
          />
        )
      }

      if (chartType === 'number') {
        const safeIndex = Math.min(numberRowIndex, sortedRows.length - 1)
        const numberData = [sortedRows[safeIndex]].filter(Boolean)
        return (
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <NumberChart
              data={numberData as Record<string, string | number>[]}
              nameKey={xKey}
              dataKey={yKeys[0] ?? columns[0] ?? ''}
              title={title}
              showLabel
            />
          </Suspense>
        )
      }

      if (chartType === 'pie') {
        // Limit pie chart to top 10 slices for readability
        const pieValueKey = yKeys[0] ?? columns[0] ?? ''
        const pieSorted = [...sortedRows].sort(
          (a, b) =>
            (Number(b[pieValueKey]) || 0) - (Number(a[pieValueKey]) || 0)
        )
        const pieData = pieSorted.slice(0, 10)
        const showPieLegend = pieData.length <= 10

        return (
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <DonutChart
              data={pieData}
              index={xKey}
              category={pieValueKey}
              readable={viz.readable}
              showLegend={showPieLegend}
              showLabel
              innerRadius={50}
              outerRadius={75}
            />
          </Suspense>
        )
      }

      if (chartType === 'bar') {
        return (
          <BarChartView
            data={sortedRows}
            xKey={xKey}
            yKeys={yKeys.length > 0 ? yKeys : [columns[1] ?? columns[0] ?? '']}
            stacked={stacked}
            logScale={logScale}
          />
        )
      }

      if (chartType === 'radial') {
        const radialData = sortedRows.slice(0, 12) as Record<
          string,
          string | number
        >[]
        return (
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <RadialChartPrimitive
              data={radialData}
              nameKey={xKey}
              dataKey={yKeys[0] ?? columns[0] ?? ''}
              showLegend={radialData.length <= 6}
              showLabel
            />
          </Suspense>
        )
      }

      if (chartType === 'bar_list') {
        const barListData = sortedRows.map((row) => ({
          name: String(row[xKey] ?? ''),
          value: Number(row[yKeys[0] ?? ''] ?? 0),
          ...row,
        }))
        return (
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <BarListPrimitive data={barListData} className="py-1" />
          </Suspense>
        )
      }

      if (chartType === 'scatter') {
        return (
          <Suspense fallback={<ChartLoadingSkeleton />}>
            <ScatterChartPrimitive
              data={sortedRows}
              xKey={xKey}
              yKeys={
                yKeys.length > 0 ? yKeys : [columns[1] ?? columns[0] ?? '']
              }
              readable={viz.readable}
            />
          </Suspense>
        )
      }

      if (chartType === 'combo') {
        const comboYKeys =
          numericColumns.length > 1
            ? numericColumns.filter((col) => col !== xKey)
            : yKeys.length > 0
              ? yKeys
              : [columns[1] ?? columns[0] ?? '']
        return (
          <ComboChartView
            data={sortedRows}
            xKey={xKey}
            yKeys={comboYKeys}
            rightAxisKeys={rightAxisKeys}
            logScale={logScale}
          />
        )
      }

      // area / line
      return (
        <Suspense fallback={<ChartLoadingSkeleton />}>
          <AreaChartPrimitive
            data={sortedRows}
            index={xKey}
            categories={
              yKeys.length > 0 ? yKeys : [columns[1] ?? columns[0] ?? '']
            }
            showXAxis
            showYAxis
            showCartesianGrid
            stack={stacked}
            opacity={chartType === 'line' ? 0 : 0.5}
            className="h-48"
          />
        </Suspense>
      )
    } catch (error) {
      console.error('AgentVisualization: Failed to render chart', error)
      return (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Unable to render chart
        </div>
      )
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border bg-card text-card-foreground',
        className
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b">
        <BarChart3Icon className="size-4 text-muted-foreground shrink-0" />
        {title && (
          <span className="text-sm font-semibold truncate max-w-[200px]">
            {title}
          </span>
        )}
        <Badge variant="secondary" className="text-xs shrink-0">
          {rowCount} rows
        </Badge>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Chart type selector */}
          <Select
            value={chartType}
            onValueChange={(v) => setChartType(v as ChartType)}
          >
            <SelectTrigger className="h-7 text-xs w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(CHART_TYPE_LABELS) as [ChartType, string][]).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>

          {/* Download button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDownload}
            title="Download CSV"
            aria-label="Download CSV"
            disabled={!hasData}
          >
            <DownloadIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="p-3 pt-2 gap-0"
      >
        <TabsList className="h-7 mb-2">
          <TabsTrigger value="chart" className="text-xs px-2.5 h-6">
            Chart
          </TabsTrigger>
          <TabsTrigger value="data" className="text-xs px-2.5 h-6">
            Data
          </TabsTrigger>
          <TabsTrigger value="query" className="text-xs px-2.5 h-6">
            Query
          </TabsTrigger>
        </TabsList>

        {/* Chart tab */}
        <TabsContent value="chart">
          <ChartControls
            columns={columns}
            numericColumns={numericColumns}
            xKey={xKey}
            yKeys={yKeys}
            sortBy={sortBy}
            sortOrder={sortOrder}
            chartType={chartType}
            rowCount={rows.length}
            numberRowIndex={numberRowIndex}
            stacked={stacked}
            logScale={logScale}
            rightAxisKeys={rightAxisKeys}
            onXKeyChange={setXKey}
            onYKeyChange={handleYKeyChange}
            onSortChange={handleSortChange}
            onNumberRowIndexChange={setNumberRowIndex}
            onStackedChange={setStacked}
            onLogScaleChange={setLogScale}
            onRightAxisKeysChange={setRightAxisKeys}
          />
          {renderChart()}
        </TabsContent>

        {/* Data tab */}
        <TabsContent value="data">
          {hasData ? (
            <DataTable
              data={rows.slice(0, 100) as Record<string, unknown>[]}
              queryConfig={queryConfig}
              context={EMPTY_TABLE_CONTEXT}
              defaultPageSize={Math.min(rows.length, 25)}
              showSQL={false}
              enableColumnFilters={false}
              enableColumnReordering={false}
              compact
              footnote={
                rows.length > 100
                  ? `Showing 100 of ${rowCount} rows`
                  : undefined
              }
            />
          ) : (
            <EmptyDataMessage />
          )}
        </TabsContent>

        {/* Query tab */}
        <TabsContent value="query">
          <CodeBlock code={sql} language="sql">
            <CodeBlockCopyButton />
          </CodeBlock>
        </TabsContent>
      </Tabs>
    </div>
  )
}
