import { createBarChart } from '@/components/charts/factory'
import { useChartData } from '@/lib/query/use-chart-data'

const TopTablesBySizeChart = createBarChart({
  chartName: 'insight-top-tables-by-size',
  index: 'table',
  categories: ['bytes'],
  defaultTitle: 'Top 10 Tables by Size',
  dateRangeConfig: 'insights',
  defaultLastHours: undefined,
})

const CompressionRatiosChart = createBarChart({
  chartName: 'insight-compression-ratios',
  index: 'table',
  categories: ['compression_ratio'],
  defaultTitle: 'Best Compression Ratios',
  dateRangeConfig: 'insights',
  defaultLastHours: undefined,
})

export function ChartsSection({ hostId }: { readonly hostId: number }) {
  const { data: topTablesData } = useChartData({
    chartName: 'insight-top-tables-by-size',
    hostId,
    lastHours: undefined,
  })
  const { data: compressionData } = useChartData({
    chartName: 'insight-compression-ratios',
    hostId,
    lastHours: undefined,
  })

  const hasTopTablesData = topTablesData && topTablesData.length > 0
  const hasCompressionData = compressionData && compressionData.length > 0

  return (
    <div className="grid auto-rows-[280px] grid-cols-1 gap-3 lg:grid-cols-2">
      {hasTopTablesData && <TopTablesBySizeChart hostId={hostId} />}
      {hasCompressionData && <CompressionRatiosChart hostId={hostId} />}
      {!hasTopTablesData && !hasCompressionData && (
        <div className="col-span-1 text-center text-muted-foreground py-8 lg:col-span-2">
          No table data available
        </div>
      )}
    </div>
  )
}
