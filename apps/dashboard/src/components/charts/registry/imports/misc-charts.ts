import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const miscChartImports: ChartRegistryMap = {
  'summary-used-by-mutations': lazy(() =>
    import('@/components/charts/summary-used-by-mutations').then((m) => ({
      default: m.ChartSummaryUsedByMutations,
    }))
  ),
  'summary-stuck-mutations': lazy(() =>
    import('@/components/charts/summary-stuck-mutations').then((m) => ({
      default: m.ChartSummaryStuckMutations,
    }))
  ),

  'summary-used-by-running-queries': lazy(() =>
    import('@/components/charts/summary-used-by-running-queries').then((m) => ({
      default: m.default,
    }))
  ),

  'connections-interserver': lazy(() =>
    import('@/components/charts/connections-interserver').then((m) => ({
      default: m.ChartConnectionsInterserver,
    }))
  ),
  'connections-http': lazy(() =>
    import('@/components/charts/connections-http').then((m) => ({
      default: m.ChartConnectionsHttp,
    }))
  ),
  'connections-pool': lazy(() =>
    import('@/components/charts/connections-pool').then((m) => ({
      default: m.ChartConnectionsPool,
    }))
  ),

  'top-table-size': lazy(() =>
    import('@/components/charts/top-table-size').then((m) => ({
      default: m.default,
    }))
  ),
  'parts-per-table': lazy(() =>
    import('@/components/charts/parts-per-table').then((m) => ({
      default: m.ChartPartsPerTable,
    }))
  ),

  'page-view': lazy(() =>
    import('@/components/charts/page-view').then((m) => ({
      default: m.PageViewBarChart,
    }))
  ),

  'dictionary-count': lazy(() =>
    import('@/components/charts/dictionary-count').then((m) => ({
      default: m.ChartDictionaryCount,
    }))
  ),

  'top-pages': lazy(() =>
    import('@/components/charts/top-pages').then((m) => ({
      default: m.TopPagesChart,
    }))
  ),
  'human-vs-bot-pageviews': lazy(() =>
    import('@/components/charts/human-vs-bot-pageviews').then((m) => ({
      default: m.HumanVsBotPageviewsChart,
    }))
  ),
  'pageviews-by-device': lazy(() =>
    import('@/components/charts/pageviews-by-device').then((m) => ({
      default: m.PageviewsByDeviceChart,
    }))
  ),
  'pageviews-by-country': lazy(() =>
    import('@/components/charts/pageviews-by-country').then((m) => ({
      default: m.PageviewsByCountryChart,
    }))
  ),
}
