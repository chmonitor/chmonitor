import type { ChartProps } from '@/components/charts/chart-props'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarList } from '@/components/charts/primitives/bar-list'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useChartData } from '@/lib/swr'

type PageViewsAnalyticsTabsProps = ChartProps & {
  defaultTab?: 'top-pages' | 'devices' | 'countries'
}

type TopPagesRow = {
  url: string
  views: number
}

type DeviceRow = {
  device: string
  views: number
}

type CountryRow = {
  country: string
  views: number
}

export const PageViewsAnalyticsTabs = function PageViewsAnalyticsTabs({
  title,
  className,
  hostId,
  defaultTab = 'top-pages',
}: PageViewsAnalyticsTabsProps) {
  const [activeTab, setActiveTab] = useState<string>(defaultTab)

  const swrTopPages = useChartData<TopPagesRow>({
    chartName: 'top-pages',
    hostId,
    refreshInterval: activeTab === 'top-pages' ? 30000 : 0,
  })

  const swrDevices = useChartData<DeviceRow>({
    chartName: 'pageviews-by-device',
    hostId,
    refreshInterval: activeTab === 'devices' ? 30000 : 0,
  })

  const swrCountries = useChartData<CountryRow>({
    chartName: 'pageviews-by-country',
    hostId,
    refreshInterval: activeTab === 'countries' ? 30000 : 0,
  })

  const isLoading =
    swrTopPages.isLoading || swrDevices.isLoading || swrCountries.isLoading

  // Combine errors (show first error if any)
  const error = swrTopPages.error || swrDevices.error || swrCountries.error

  const combinedSwr = {
    ...swrTopPages,
    isLoading,
    error,
    data: swrTopPages.data, // Primary data for container
  }

  return (
    <ChartContainer swr={combinedSwr} title={title} className={className}>
      {(_, primarySql, primaryMetadata) => {
        const topPagesData =
          swrTopPages.data?.map((row) => ({
            name: row.url as string,
            value: row.views as number,
            formatted: row.views.toString(),
          })) ?? []

        const deviceData =
          swrDevices.data?.map((row) => ({
            name: row.device as string,
            value: row.views as number,
            formatted: row.views.toString(),
          })) ?? []

        const countryData =
          swrCountries.data?.map((row) => ({
            name: row.country as string,
            value: row.views as number,
            formatted: row.views.toString(),
          })) ?? []

        return (
          <ChartCard
            title={title}
            className={className}
            sql={primarySql}
            data={swrTopPages.data ?? []}
            metadata={primaryMetadata}
            data-testid="page-views-analytics-chart"
          >
            <Tabs
              id="page-views-analytics-tabs"
              defaultValue={defaultTab}
              className="overflow-hidden"
              onValueChange={setActiveTab}
            >
              <TabsList className="h-11 sm:h-9 gap-1 mb-3 p-1">
                <TabsTrigger
                  key="top-pages"
                  value="top-pages"
                  className="!h-auto min-h-10 sm:min-h-0 px-3 sm:px-2 py-2 sm:py-1"
                >
                  Top Pages
                </TabsTrigger>
                <TabsTrigger
                  key="devices"
                  value="devices"
                  className="!h-auto min-h-10 sm:min-h-0 px-3 sm:px-2 py-2 sm:py-1"
                >
                  Devices
                </TabsTrigger>
                <TabsTrigger
                  key="countries"
                  value="countries"
                  className="!h-auto min-h-10 sm:min-h-0 px-3 sm:px-2 py-2 sm:py-1"
                >
                  Countries
                </TabsTrigger>
              </TabsList>
              <TabsContent value="top-pages" className="overflow-hidden">
                <BarList data={topPagesData} formatedColumn="formatted" />
              </TabsContent>
              <TabsContent value="devices" className="overflow-hidden">
                <BarList data={deviceData} formatedColumn="formatted" />
              </TabsContent>
              <TabsContent value="countries" className="overflow-hidden">
                <BarList data={countryData} formatedColumn="formatted" />
              </TabsContent>
            </Tabs>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default PageViewsAnalyticsTabs

// Alias for backward compatibility with existing imports
export { PageViewsAnalyticsTabs as TopPagesChart }
