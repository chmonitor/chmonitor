import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/zookeeper/zookeeper-requests.tsx`
 * (`ChartZookeeperRequests`) — ported as a template for plans/58, and the
 * catalog's `type: 'bar'` example (`createBarChart`).
 */
export const zookeeperRequestsDeclarative: DeclarativeChart = {
  type: 'bar',
  chartName: 'zookeeper-requests',
  icon: 'network',
  description: 'ZooKeeper/Keeper request and watch volume over time',
  index: 'event_time',
  categories: ['ZookeeperRequests', 'ZooKeeperWatch'],
  defaultTitle: 'ZooKeeper Requests',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24 * 7,
  dataTestId: 'zookeeper-requests-chart',
  dateRangeConfig: 'health',
  xAxisDateFormat: true,
  barChartProps: {
    showLegend: true,
    stack: true,
    yAxisTickFormatterKey: 'count',
  },
}
