import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

const seen: Array<{
  query: string
  query_params?: Record<string, unknown>
}> = []

function setup(opts: { rows?: Record<string, unknown>[]; fail?: string } = {}) {
  seen.length = 0
  mockFetchData.mockImplementation(async (o: any) => {
    seen.push(o)
    if (opts.fail) return { data: [], error: { message: opts.fail } }
    return { data: opts.rows ?? [], error: null }
  })
}

const {
  createDetachedPartsTools,
  buildDetachedPartsTriageSql,
  DETACHED_PARTS_LIMIT,
  DETACHED_SOURCE_ANCHOR,
  DETACHED_LIMIT_ANCHOR,
} = await import('../detached-parts-tools')
const { detachedPartsTriageConfig } = await import(
  '@/lib/query-config/tables/detached-parts-triage'
)
const tool = () =>
  (createDetachedPartsTools(0) as any).get_detached_parts_triage

const row = {
  database: 'shop',
  table: 'events',
  reason: 'broken',
  triage: 'needs_attention',
  parts: '3',
  bytes: '2048',
  readable_bytes: '2.00 KiB',
  partitions: '2',
  covered_by_active: '1',
  oldest_modified: '2026-08-01 00:00:00',
  newest_modified: '2026-08-02 00:00:00',
  oldest_age_days: '82',
}

describe('get_detached_parts_triage', () => {
  test('returns scope, caveats and shaped rows', async () => {
    setup({ rows: [row] })
    const r = await tool().execute({})
    expect(r.ok).toBe(true)
    expect(r.scope).toBe('this replica only')
    expect(r.groups).toEqual([
      {
        ...row,
        parts: 3,
        bytes: 2048,
        partitions: 2,
        covered_by_active: 1,
        oldest_age_days: 82,
      },
    ])
    expect(r.truncated).toBe(false)
    const caveats = r.caveats.join(' ')
    expect(caveats).toContain('does not prove any other replica')
    expect(caveats).toContain('Review each part before any removal')
    expect(caveats).toContain('cannot be removed via SQL')
  })

  test('filters travel only as bound parameters, never in the SQL text', async () => {
    setup()
    const evil = "x'; DROP TABLE t; --"
    await tool().execute({ database: evil, table: 'a.b' })
    expect(seen).toHaveLength(1)
    expect(seen[0].query_params).toEqual({ database: evil, table: 'a.b' })
    expect(seen[0].query).not.toContain('DROP TABLE t')
    expect(seen[0].query).not.toContain('a.b')
    expect(seen[0].query).toContain('{database:String}')
    expect(seen[0].query).toContain('{table:String}')
  })

  test('no filter binds empty strings', async () => {
    setup()
    await tool().execute({})
    expect(seen[0].query_params).toEqual({ database: '', table: '' })
  })

  test('SQL is the config text, narrowed and capped at 50, with no WITH aliases', () => {
    const sql = buildDetachedPartsTriageSql()
    expect(sql).toContain(`LIMIT ${DETACHED_PARTS_LIMIT}`)
    expect(sql).not.toContain('LIMIT 200')
    expect(sql).toContain('multiIf(')
    expect(sql).not.toMatch(/^\s*WITH\b/im)
    expect(sql).not.toMatch(/\b(ALTER|DROP|ATTACH|TRUNCATE)\b/i)
  })

  test('the config still has exactly one of each anchor the tool rewrites', () => {
    const variants = detachedPartsTriageConfig.sql as { sql: string }[]
    expect(variants.length).toBeGreaterThan(0)
    for (const { sql } of variants) {
      expect(sql.split(DETACHED_SOURCE_ANCHOR)).toHaveLength(2)
      expect(sql.split(DETACHED_LIMIT_ANCHOR)).toHaveLength(2)
    }
  })

  test('a full page is flagged truncated', async () => {
    setup({ rows: Array.from({ length: DETACHED_PARTS_LIMIT }, () => row) })
    const r = await tool().execute({})
    expect(r.truncated).toBe(true)
  })

  test('fails open with a clear message when system.detached_parts is unreadable', async () => {
    setup({ fail: 'Unknown table system.detached_parts' })
    const r = await tool().execute({})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Could not read system.detached_parts')
    expect(r.error).toContain('Unknown table')
    expect(r.caveats.length).toBeGreaterThan(0)
  })

  test('description and output never invite removal or contain DDL text', async () => {
    setup({ rows: [row] })
    const r = await tool().execute({})
    const text = `${tool().description} ${JSON.stringify(r)}`
    expect(text).not.toMatch(
      /\b(DROP|ALTER|ATTACH)\s+(DETACHED|PART|PARTITION|TABLE)/i
    )
    expect(tool().description).toContain('THIS REPLICA ONLY')
    expect(tool().description).toContain('No class means safe to remove')
    expect(tool().description).toContain('never produces a command')
  })
})
