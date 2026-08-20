import type { TableSchema } from './types'

import { compareCatalogs } from './compare'
import { buildChangePlan, safeStatementsForTables } from './plan'
import { describe, expect, test } from 'bun:test'

function table(
  partial: Partial<TableSchema> & Pick<TableSchema, 'database' | 'table'>
): TableSchema {
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

describe('buildChangePlan', () => {
  test('additive-only fixture produces only CREATE and ALTER ADD', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'new_tbl',
          createTableQuery:
            'CREATE TABLE app.new_tbl (`id` UInt64) ENGINE = MergeTree ORDER BY id',
        }),
        table({
          database: 'app',
          table: 'events',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'note', type: 'String', codec: '' },
          ],
          indexes: [
            {
              name: 'idx_note',
              type: 'bloom_filter',
              expr: 'note',
              granularity: '1',
            },
          ],
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 'events',
          columns: [{ name: 'id', type: 'UInt64', codec: '' }],
        }),
      ],
    }

    const plan = buildChangePlan(compareCatalogs(source, target))
    expect(plan.items.every((i) => i.kind !== 'manual')).toBe(true)
    expect(
      plan.safeStatements.every((s) => /^(CREATE|ALTER TABLE .+ ADD )/i.test(s))
    ).toBe(true)
    expect(plan.safeStatements.some((s) => s.startsWith('CREATE TABLE'))).toBe(
      true
    )
    expect(plan.safeStatements.some((s) => s.includes('ADD COLUMN'))).toBe(true)
    expect(plan.safeStatements.some((s) => s.includes('ADD INDEX'))).toBe(true)
    expect(plan.items.some((i) => /DROP/i.test(i.statement))).toBe(false)
  })

  test('engine or ORDER BY mismatch is flagged, not rewritten', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 't',
          engine: 'ReplacingMergeTree',
          sortingKey: 'id, ts',
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 't',
          engine: 'MergeTree',
          sortingKey: 'id',
        }),
      ],
    }

    const plan = buildChangePlan(compareCatalogs(source, target))
    const manuals = plan.items.filter((i) => i.kind === 'manual')
    expect(manuals.length).toBeGreaterThanOrEqual(2)
    expect(
      manuals.every((i) => i.risk === 'rewrite' && i.statement === '')
    ).toBe(true)
    expect(plan.safeStatements).toEqual([])
    expect(plan.items.some((i) => /ENGINE\s*=/i.test(i.statement))).toBe(false)
    expect(plan.items.some((i) => /MODIFY ORDER BY/i.test(i.statement))).toBe(
      false
    )
  })

  test('drop column is a manual note, never a DROP statement', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 't',
          columns: [{ name: 'id', type: 'UInt64', codec: '' }],
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 't',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'gone', type: 'String', codec: '' },
          ],
        }),
      ],
    }

    const plan = buildChangePlan(compareCatalogs(source, target))
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].kind).toBe('manual')
    expect(plan.items[0].statement).toBe('')
    expect(plan.items[0].summary).toContain('gone')
    expect(plan.safeStatements).toEqual([])
  })

  test('type change emits MODIFY COLUMN as mutation, not safe', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 't',
          columns: [{ name: 'id', type: 'UInt128', codec: '' }],
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 't',
          columns: [{ name: 'id', type: 'UInt64', codec: '' }],
        }),
      ],
    }

    const plan = buildChangePlan(compareCatalogs(source, target))
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].kind).toBe('modify_column')
    expect(plan.items[0].risk).toBe('mutation')
    expect(plan.items[0].safe).toBe(false)
    expect(plan.items[0].statement).toContain('MODIFY COLUMN')
    expect(plan.safeStatements).toEqual([])
  })

  test('Distributed table plan items expose local table + ON CLUSTER variant', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'events_dist',
          engine: 'Distributed',
          createTableQuery:
            "CREATE TABLE app.events_dist (`id` UInt64, `note` String) ENGINE = Distributed('analytics', 'default', 'events_local', rand())",
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'note', type: 'String', codec: '' },
          ],
        }),
      ],
    }
    const target = {
      tables: [
        table({
          database: 'app',
          table: 'events_dist',
          engine: 'Distributed',
          createTableQuery:
            "CREATE TABLE app.events_dist (`id` UInt64) ENGINE = Distributed('analytics', 'default', 'events_local', rand())",
        }),
      ],
    }

    const plan = buildChangePlan(compareCatalogs(source, target))
    const add = plan.items.find((i) => i.kind === 'add_column')
    expect(add).toBeTruthy()
    expect(add?.localTableName).toBe('default.events_local')
    expect(add?.statement).toContain('`default`.`events_local`')
    expect(add?.onClusterStatement).toContain("ON CLUSTER 'analytics'")
    expect(add?.onClusterStatement).toContain('ADD COLUMN')
    expect(add?.localOnlyReason).toBeNull()
  })

  test('cluster metadata without Distributed still adds ON CLUSTER to the same table', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'events',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'note', type: 'String', codec: '' },
          ],
        }),
      ],
    }
    const target = {
      tables: [table({ database: 'app', table: 'events' })],
    }

    const plan = buildChangePlan(compareCatalogs(source, target), {
      cluster: 'prod',
    })
    const add = plan.items.find((i) => i.kind === 'add_column')
    expect(add?.localTableName).toBe('app.events')
    expect(add?.onClusterStatement).toContain("ON CLUSTER 'prod'")
    expect(add?.statement).not.toMatch(/ON CLUSTER/i)
  })

  test('single-host plan without topology does not add ON CLUSTER', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'events',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'note', type: 'String', codec: '' },
          ],
        }),
      ],
    }
    const target = {
      tables: [table({ database: 'app', table: 'events' })],
    }
    const plan = buildChangePlan(compareCatalogs(source, target))
    const add = plan.items.find((i) => i.kind === 'add_column')
    expect(add?.onClusterStatement ?? null).toBeNull()
    expect(add?.statement).toMatch(/^ALTER TABLE /)
    expect(add?.statement).not.toMatch(/ON CLUSTER/i)
  })
})

describe('safeStatementsForTables', () => {
  test('empty selection returns every safe statement; a key filters the plan', () => {
    const source = {
      tables: [
        table({
          database: 'app',
          table: 'new_tbl',
          createTableQuery:
            'CREATE TABLE app.new_tbl (`id` UInt64) ENGINE = MergeTree ORDER BY id',
        }),
        table({
          database: 'app',
          table: 'events',
          columns: [
            { name: 'id', type: 'UInt64', codec: '' },
            { name: 'note', type: 'String', codec: '' },
          ],
        }),
      ],
    }
    const target = {
      tables: [table({ database: 'app', table: 'events' })],
    }
    const plan = buildChangePlan(compareCatalogs(source, target))
    expect(safeStatementsForTables(plan, null)).toEqual(plan.safeStatements)
    expect(safeStatementsForTables(plan, new Set())).toEqual(
      plan.safeStatements
    )
    expect(safeStatementsForTables(plan, new Set(['app.new_tbl']))).toEqual(
      plan.items
        .filter((i) => i.tableKey === 'app.new_tbl' && i.safe && i.statement)
        .map((i) => i.statement)
    )
    expect(safeStatementsForTables(plan, new Set(['app.events']))).toEqual(
      plan.items
        .filter((i) => i.tableKey === 'app.events' && i.safe && i.statement)
        .map((i) => i.statement)
    )
  })
})
