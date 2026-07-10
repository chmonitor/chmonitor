import type { DeclarativeQueryConfig } from '../../schema'

export const topUsageTablesDeclarative: DeclarativeQueryConfig = {
  name: 'top-usage-tables',
  defaultView: 'auto',
  card: { primary: 'table' },
  description:
    'Most usage tables, ignore system tables, based on system.query_log (top 50). Click on table name to see top usage columns.',
  // Inlined from table-notes QUERY_LOG (docs is now a plain string)
  docs: `The required table 'query_log' may be missing. Please follow the documentation at https://clickhouse.com/docs/en/operations/server-configuration-parameters/settings#query-log and https://clickhouse.com/docs/en/operations/system-tables/query_log to ensure the necessary table is available.`,
  optional: false,
  tableCheck: 'system.query_log',
  sql: [
    {
      since: '23.8',
      sql: `
      SELECT
          tables as table,
          count() as count,
          round(100 * count() / nullIf(max(count()) OVER (), 0)) as pct_count,
          pct_count as pct_pct_count
      FROM merge('system', '^query_log')
      ARRAY JOIN tables
      WHERE (query_kind = 'Select')
        AND (if({database: String} != '', startsWith(table, {database: String}), true))
        AND (type = 'QueryFinish')
        AND (tables NOT LIKE '%temp%')
        AND (tables NOT LIKE '_table_function%')
        AND (tables NOT LIKE 'system%')
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 50`,
      description: 'Base query without query_cache_usage',
    },
    {
      since: '24.1',
      sql: `
      SELECT
          tables as table,
          count() as count,
          round(100 * count() / nullIf(max(count()) OVER (), 0)) as pct_count,
          pct_count as pct_pct_count,
          countIf(query_cache_usage = 'Read') as cache_hits,
          countIf(query_cache_usage != 'None' AND query_cache_usage != 'Unknown') as cache_usage,
          round(100 * countIf(query_cache_usage = 'Read') / count(), 2) as cache_hit_rate,
          round(cache_hit_rate, 2) as pct_cache_hit_rate
      FROM merge('system', '^query_log')
      ARRAY JOIN tables
      WHERE (query_kind = 'Select')
        AND (if({database: String} != '', startsWith(table, {database: String}), true))
        AND (type = 'QueryFinish')
        AND (tables NOT LIKE '%temp%')
        AND (tables NOT LIKE '_table_function%')
        AND (tables NOT LIKE 'system%')
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 50`,
      description: 'Added query_cache_usage aggregations for cache insights',
      columns: [
        'table',
        'count',
        'pct_count',
        'cache_hits',
        'cache_usage',
        'cache_hit_rate',
      ],
    },
  ],
  columns: [
    'table',
    'count',
    'pct_count',
    'cache_hits',
    'cache_usage',
    'cache_hit_rate',
  ],
  columnFormats: {
    table: [
      'link',
      { href: `/top-usage-columns?host=[ctx.hostId]&table=[table]` },
    ],
    count: 'background-bar',
    pct_count: ['background-bar', { numberFormat: true }],
    cache_hits: 'number',
    cache_usage: 'number',
    cache_hit_rate: ['background-bar', { numberFormat: true }],
  },
  defaultParams: { database: '' },
}
