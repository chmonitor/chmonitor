/**
 * Runs the batched table-existence query against a real ClickHouse, because
 * the unit suite mocks the client and missed that the server rejected the
 * serialized parameter on every call (#3906). Skips without CLICKHOUSE_HOST.
 */
import { describe, expect, it } from 'bun:test'

const host = process.env.CLICKHOUSE_HOST?.split(',')[0]?.trim()

async function reachable(url: string | undefined): Promise<boolean> {
  if (!url) return false
  try {
    const res = await fetch(new URL('/ping', url), {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

const live = await reachable(host)

describe.skipIf(!live)('checkTablesExist against a live server (#3906)', () => {
  it('reports a present table as true and a missing one as false', async () => {
    const { checkTablesExist, clearTableCache } = await import(
      new URL('../table-existence-cache.ts?test=live', import.meta.url).href
    )
    clearTableCache()

    const result = await checkTablesExist(0, [
      ['system', 'tables'],
      ['system', 'chm_no_such_table_3906'],
    ])

    expect(result.get('system.tables')).toBe(true)
    expect(result.get('system.chm_no_such_table_3906')).toBe(false)
  })
})
