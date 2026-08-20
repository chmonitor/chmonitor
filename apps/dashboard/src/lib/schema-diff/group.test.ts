import { assembleCatalog } from './catalog'
import { compareCatalogs } from './compare'
import { groupDiffsByDatabase, tableNameOf } from './group'
import { describe, expect, test } from 'bun:test'

describe('groupDiffsByDatabase', () => {
  test('nests tables under a sorted database folder', () => {
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
          table: 'users',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.users (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
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
      []
    )
    const diff = compareCatalogs(catalog, catalog)
    const groups = groupDiffsByDatabase(diff.identical)
    expect(groups.map((g) => g.database)).toEqual(['app', 'zeta'])
    expect(groups[0].tables.map(tableNameOf)).toEqual(['events', 'users'])
    expect(groups[1].tables.map(tableNameOf)).toEqual(['b'])
  })

  test('name-desc reverses database and table order', () => {
    const catalog = assembleCatalog(
      [
        {
          database: 'app',
          table: 'users',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.users (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
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
      []
    )
    const diff = compareCatalogs(catalog, catalog)
    const groups = groupDiffsByDatabase(diff.identical, 'name-desc')
    expect(groups[0].tables.map(tableNameOf)).toEqual(['users', 'events'])
  })

  test('kind sort puts changed tables before identical', () => {
    const source = assembleCatalog(
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
        {
          database: 'app',
          table: 'users',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.users (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
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
    const target = assembleCatalog(
      [
        {
          database: 'app',
          table: 'events',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.events (id UInt32) ENGINE = MergeTree ORDER BY id',
        },
        {
          database: 'app',
          table: 'users',
          engine: 'MergeTree',
          sorting_key: 'id',
          partition_key: '',
          primary_key: 'id',
          create_table_query:
            'CREATE TABLE app.users (id UInt64) ENGINE = MergeTree ORDER BY id',
        },
      ],
      [
        {
          database: 'app',
          table: 'events',
          name: 'id',
          type: 'UInt32',
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
    const diff = compareCatalogs(source, target)
    const groups = groupDiffsByDatabase(
      [...diff.changed, ...diff.identical],
      'kind'
    )
    expect(groups[0].tables.map((row) => row.kind)).toEqual([
      'changed',
      'identical',
    ])
  })
})
