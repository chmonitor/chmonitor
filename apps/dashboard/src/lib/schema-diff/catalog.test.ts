import { assembleCatalog } from './catalog'
import { describe, expect, test } from 'bun:test'

describe('assembleCatalog', () => {
  test('joins columns, indexes, and projections onto their tables', () => {
    const catalog = assembleCatalog(
      [
        {
          database: 'app',
          table: 'events',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.events (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'id',
          type: 'UInt64',
          codec: 'LZ4',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'idx_id',
          type: 'minmax',
          expr: 'id',
          granularity: 4,
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'proj_daily',
          type: 'Aggregate',
          query:
            'SELECT toDate(ts) AS day, count() FROM app.events GROUP BY day',
        },
      ]
    )

    expect(catalog.tables).toHaveLength(1)
    const table = catalog.tables[0]
    expect(table.columns).toEqual([
      { name: 'id', type: 'UInt64', codec: 'LZ4' },
    ])
    expect(table.indexes).toEqual([
      { name: 'idx_id', type: 'minmax', expr: 'id', granularity: '4' },
    ])
    expect(table.projections).toEqual([
      {
        name: 'proj_daily',
        type: 'Aggregate',
        query: 'SELECT toDate(ts) AS day, count() FROM app.events GROUP BY day',
      },
    ])
  })

  test('ignores orphan column rows and coerces missing engine fields to empty strings', () => {
    const catalog = assembleCatalog(
      [
        {
          database: 'app',
          table: 'users',
          engine: '',
          sorting_key: '',
          partition_key: '',
          primary_key: '',
          create_table_query: '',
        },
      ],
      [
        {
          database: 'app',
          table: 'missing',
          name: 'id',
          type: 'UInt64',
          codec: '',
        },
        {
          database: 'app',
          table: 'users',
          name: 'id',
          type: 'UInt64',
          codec: '',
        },
      ]
    )

    expect(catalog.tables[0].engine).toBe('')
    expect(catalog.tables[0].columns).toEqual([
      { name: 'id', type: 'UInt64', codec: '' },
    ])
  })

  test('sorts tables by database.table key', () => {
    const catalog = assembleCatalog(
      [
        {
          database: 'zeta',
          table: 'b',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE zeta.b (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
        {
          database: 'app',
          table: 'a',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.a (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
      ],
      []
    )

    expect(catalog.tables.map((t) => `${t.database}.${t.table}`)).toEqual([
      'app.a',
      'zeta.b',
    ])
  })
})
