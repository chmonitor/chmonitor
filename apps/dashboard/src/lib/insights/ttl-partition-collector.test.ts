import { describe, expect, mock, test } from 'bun:test'

mock.module('../ai/agent/tools/helpers', () => ({
  readOnlyQuery: async () => [],
}))

const {
  insightFromTtlInventoryRows,
  rowFromTtlInventoryRecord,
} = await import('./ttl-partition-collector')

describe('rowFromTtlInventoryRecord', () => {
  test('maps QueryConfig inventory columns', () => {
    expect(
      rowFromTtlInventoryRecord({
        database: 'analytics',
        name: 'events',
        table: 'events',
        partition_key: 'toYYYYMM(ts)',
        ttl_expression: '',
        partitions: '1200',
        active_parts: 2400,
      })
    ).toEqual({
      database: 'analytics',
      table: 'events',
      partitionKey: 'toYYYYMM(ts)',
      ttlExpression: '',
      partitions: 1200,
      activeParts: 2400,
    })
  })
})

describe('insightFromTtlInventoryRows', () => {
  test('returns empty when nothing is flagged', () => {
    expect(
      insightFromTtlInventoryRows([
        {
          database: 'db',
          table: 'ok',
          partition_key: 'tuple()',
          ttl_expression: '',
          partitions: 2,
          active_parts: 2,
        },
      ])
    ).toEqual([])
  })

  test('emits one insight for the worst flagged table', () => {
    const out = insightFromTtlInventoryRows([
      {
        database: 'a',
        table: 'mid',
        partition_key: 'toYYYYMM(ts)',
        ttl_expression: '',
        partitions: 600,
        active_parts: 600,
      },
      {
        database: 'b',
        table: 'worst',
        partition_key: 'toYYYYMM(ts)',
        ttl_expression: '',
        partitions: 1500,
        active_parts: 1500,
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('ttl_partition_health')
    expect(out[0]?.title).toContain('b.worst')
    expect(out[0]?.severity).toBe('critical')
    expect(out[0]?.value).toBe(1500)
    expect(out[0]?.action).toEqual({
      label: 'View TTL inventory',
      href: '/ttl-partition-health',
    })
  })
})
