import type { ChartQueryBuilder } from './types'

export const dictionaryCharts: Record<string, ChartQueryBuilder> = {
  'dictionary-count': () => ({
    // `system.dictionaries` exists on all supported versions, but mark the chart
    // optional + tableCheck so deployments without it (or with a restricted
    // grant) degrade to an empty state instead of erroring with a 500.
    optional: true,
    tableCheck: 'system.dictionaries',
    query: `
      SELECT
        status,
        count() as count
      FROM system.dictionaries
      GROUP BY status
      ORDER BY count DESC
    `,
  }),
}
