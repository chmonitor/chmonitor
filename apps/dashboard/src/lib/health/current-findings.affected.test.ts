/**
 * #3998: a current finding carries the names behind a count-only rule as data
 * (`affected`), not only inside its human label, so the findings API and the
 * read-only MCP tool expose the same list the webhook `alert` block does.
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'

const realModule = { ...(await import('@chm/clickhouse-client')) }

mock.module('@chm/clickhouse-client', () => ({
  ...realModule,
  fetchData: async (args: { query: string }) => {
    if (args.query.includes("'table' AS kind")) {
      return {
        data: [{ kind: 'table', name: 'system.mutations' }],
        metadata: {},
        error: undefined,
      }
    }
    if (args.query.includes('FROM system.mutations')) {
      return {
        data: [{ failed_count: '2', affected: ['db.a', 'db.b'] }],
        metadata: {},
        error: undefined,
      }
    }
    return { data: [{ v: '0' }], metadata: {}, error: undefined }
  },
  getClickHouseConfigs: () => [
    { id: 3998, host: 'test-host', user: 'default', password: '' },
  ],
}))

afterAll(() => {
  mock.module('@chm/clickhouse-client', () => ({ ...realModule }))
})

const { getCurrentFindings } = await import('./current-findings')

describe('getCurrentFindings affected names', () => {
  test('a count-only rule finding lists its affected names', async () => {
    // A host id no other file probes, so no cached capability probe applies.
    const findings = await getCurrentFindings({ hostId: 3998 })
    const failed = findings.find((f) => f.ruleId === 'failed-mutations')
    expect(failed?.affected).toEqual(['db.a', 'db.b'])
  })
})
