import type { ChartQueryBuilder } from './types'

import {
  DASHBOARD_CHARTS_TABLE,
  DASHBOARD_SETTINGS_TABLE,
} from '@/lib/app-tables'

export const dashboardCharts: Record<string, ChartQueryBuilder> = {
  'dashboard-charts': () => ({
    query: `
      SELECT * FROM ${DASHBOARD_CHARTS_TABLE} FINAL
      ORDER BY ordering ASC
    `,
    optional: true,
    tableCheck: DASHBOARD_CHARTS_TABLE,
  }),

  'dashboard-settings': () => ({
    query: `
      SELECT * FROM ${DASHBOARD_SETTINGS_TABLE} FINAL
    `,
    optional: true,
    tableCheck: DASHBOARD_SETTINGS_TABLE,
  }),
}
