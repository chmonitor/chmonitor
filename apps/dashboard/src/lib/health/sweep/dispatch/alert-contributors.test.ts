import { CONTRIBUTOR_SOURCES, fetchTopContributors } from './alert-contributors'
import { describe, expect, test } from 'bun:test'

describe('fetchTopContributors', () => {
  test('disk rules list tables by bytes on disk', async () => {
    let sql = ''
    const out = await fetchTopContributors('disk-usage', 7, async (s, host) => {
      sql = s
      expect(host).toBe(7)
      return [{ database: 'app', table: 'big', bytes_on_disk: '2048' }]
    })
    expect(out).toEqual([
      { kind: 'table', database: 'app', table: 'big', bytesOnDisk: 2048 },
    ])
    expect(sql).toContain('sum(bytes_on_disk)')
    expect(sql).toContain('LIMIT 5')
  })

  test('parts rule lists tables by active parts', async () => {
    const out = await fetchTopContributors('parts-pressure', 1, async () => [
      { database: 'app', table: 'many', active_parts: '900' },
    ])
    expect(out).toEqual([
      { kind: 'table', database: 'app', table: 'many', activeParts: 900 },
    ])
  })

  test('query rules carry the normalized shape, never raw text', async () => {
    const out = await fetchTopContributors(
      'heavy-query-memory',
      1,
      async () => [
        {
          query_id: 'q1',
          user: 'alice',
          elapsed_seconds: 12.5,
          memory_usage: 1000,
          normalized_query: 'SELECT ? FROM t WHERE k = ?',
          query: "SELECT 1 FROM t WHERE k = 'secret'",
        },
      ]
    )
    expect(out).toEqual([
      {
        kind: 'query',
        queryId: 'q1',
        user: 'alice',
        elapsedSeconds: 12.5,
        memoryBytes: 1000,
        normalizedQuery: 'SELECT ? FROM t WHERE k = ?',
      },
    ])
    expect(JSON.stringify(out)).not.toContain('secret')
    for (const rule of [
      'memory-pressure',
      'heavy-query-memory',
      'long-running-queries',
    ]) {
      const { sql } = CONTRIBUTOR_SOURCES[rule]
      expect(sql).toContain('normalizeQuery(query)')
      expect(sql).not.toMatch(/substring\(query,/)
    }
  })

  test('is bounded to 5 rows', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      database: 'd',
      table: `t${i}`,
      active_parts: i,
    }))
    const out = await fetchTopContributors(
      'parts-pressure',
      1,
      async () => rows
    )
    expect(out).toHaveLength(5)
  })

  test('a read failure, an empty result, or an unsupported rule yields undefined', async () => {
    expect(
      await fetchTopContributors('disk-usage', 1, async () => {
        throw new Error('boom')
      })
    ).toBeUndefined()
    expect(
      await fetchTopContributors('disk-usage', 1, async () => [])
    ).toBeUndefined()
    let called = false
    expect(
      await fetchTopContributors('failed-backups', 1, async () => {
        called = true
        return []
      })
    ).toBeUndefined()
    expect(called).toBe(false)
  })
})
