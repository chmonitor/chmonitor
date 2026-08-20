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
})
