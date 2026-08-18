import { describe, expect, test } from 'bun:test'

import { assembleCatalog } from './catalog'
import { compareCatalogs } from './compare'
import type { TableSchema } from './types'

function table(partial: Partial<TableSchema> & Pick<TableSchema, 'database' | 'table'>): TableSchema {
  return {
    engine: 'MergeTree',
    sortingKey: 'id',
    partitionKey: '',
    primaryKey: 'id',
    createTableQuery: `CREATE TABLE ${partial.database}.${partial.table} (id UInt64) ENGINE = MergeTree ORDER BY id`,
    columns: [{ name: 'id', type: 'UInt64', codec: '' }],
    indexes: [],
    projections: [],
    ...partial,
  }
}

describe('assembleCatalog', () => {
  test('nests columns, indexes, and projections under tables', () => {
    const catalog = assembleCatalog(
      [
        {
          database: 'app',
          table: 'events',
          engine: 'MergeTree',
          sorting_key: 'ts',
          partition_key: 'toYYYYMM(ts)',
          primary_key: 'ts',
          create_table_query: 'CREATE TABLE app.events ...',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'ts',
          type: 'DateTime',
          codec: '',
        },
        {
          database: 'app',
          table: 'events',
          name: 'payload',
          type: 'String',
          codec: 'CODEC(ZSTD(1))',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'idx_ts',
          type: 'minmax',
          expr: 'ts',
          granularity: '1',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'by_day',
          type: 'Normal',
          query: 'SELECT * ORDER BY ts',
        },
      ]
    )

    expect(catalog.tables).toHaveLength(1)
    expect(catalog.tables[0].columns.map((c) => c.name)).toEqual(['ts', 'payload'])
    expect(catalog.tables[0].indexes).toHaveLength(1)
    expect(catalog.tables[0].projections[0].name).toBe('by_day')
  })
})

describe('compareCatalogs', () => {
  test('buckets missing table, extra column, and type change', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'only_src',
          createTableQuery: 'CREATE TABLE app.only_src (id UInt64) ENGINE = MergeTree ORDER BY id',
        }),
        table({
          database: 'app',
          table: 'shared',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'extra', type: 'String', codec: '' },
            { name: 'amount', type: 'Float64', codec: '' },
          ],
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 'shared',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'amount', type: 'Float32', codec: '' },
          ],
        }),
      ],
    }

    const diff = compareCatalogs(source, target)

    expect(diff.onlySource.map((r) => r.key)).toEqual(['app.only_src'])
    expect(diff.onlyTarget).toEqual([])
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].key).toBe('app.shared')
    expect(diff.changed[0].changes.map((c) => c.field).sort()).toEqual([
      'column:extra',
      'column_type:amount',
    ])
  })

  test('identical tables land in identical', () => {
    const t = table({ database: 'app', table: 'same' })
    const diff = compareCatalogs({ tables: [t] }, { tables: [structuredClone(t)] })
    expect(diff.identical.map((r) => r.key)).toEqual(['app.same'])
    expect(diff.changed).toEqual([])
  })

  test('table only on target is only_target', () => {
    const diff = compareCatalogs(
      { tables: [] },
      { tables: [table({ database: 'app', table: 'tgt' })] }
    )
    expect(diff.onlyTarget.map((r) => r.key)).toEqual(['app.tgt'])
  })
})
