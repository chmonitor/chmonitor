import type { DeclarativeQueryConfig } from '../../schema'

export const dictionariesDeclarative: DeclarativeQueryConfig = {
  name: 'dictionaries',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['status', 'type'] },
  description: 'External dictionaries loaded in ClickHouse',
  suggestion: `Create an external dictionary:

CREATE DICTIONARY my_dict
(
  id UInt64,
  name String
)
PRIMARY KEY id
SOURCE(HTTP(URL 'http://source.example.com/data.csv'))
LIFETIME(MIN 300 MAX 600)
LAYOUT(FLAT());

Sources: File, HTTP, MySQL, PostgreSQL, ClickHouse, Redis, Mongo, etc.

Enable periodic refresh:
SET dictionary_refresh_interval = 300;

Monitor status, size, load times, and exceptions here.

Learn more:
https://clickhouse.com/docs/en/sql-reference/dictionaries`,
  optional: true,
  tableCheck: 'system.dictionaries',
  sql: `
    SELECT
      database,
      name,
      status,
      origin,
      type,
      key.names as key_names,
      key.types as key_types,
      attribute.names as attribute_names,
      attribute.types as attribute_types,
      bytes_allocated,
      formatReadableSize(bytes_allocated) as readable_bytes_allocated,
      round(bytes_allocated * 100.0 / nullIf(max(bytes_allocated) OVER (), 0), 2) as pct_bytes_allocated,
      hierarchical,
      is_injective,
      element_count,
      formatReadableQuantity(element_count) as readable_element_count,
      load_factor,
      loading_start_time,
      loading_duration,
      last_successful_update_time,
      last_exception,
      source
    FROM system.dictionaries
    ORDER BY database, name
  `,
  columns: [
    'database',
    'name',
    'status',
    'type',
    'readable_bytes_allocated',
    'readable_element_count',
    'load_factor',
    'loading_duration',
    'last_successful_update_time',
    'last_exception',
  ],
  columnFormats: {
    database: 'colored-badge',
    name: 'text',
    status: 'colored-badge',
    type: 'colored-badge',
    readable_bytes_allocated: 'background-bar',
    readable_element_count: 'number',
    load_factor: 'number',
    loading_duration: 'duration',
    last_successful_update_time: 'related-time',
    last_exception: [
      'code-dialog',
      { max_truncate: 40, dialog_title: 'Dictionary Exception' },
    ],
  },
  relatedCharts: ['dictionary-count'],
}
