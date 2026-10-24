import { completeSql, parseTableRefs, type SqlSchema } from './complete'
import { describe, expect, test } from 'bun:test'

const schema: SqlSchema = {
  databases: ['default', 'system'],
  tables: { system: ['query_log', 'tables'], default: ['events'] },
  columns: {
    'system.query_log': [
      { name: 'query_id', type: 'String' },
      { name: 'event_time', type: 'DateTime' },
    ],
    'default.events': [{ name: 'user_id', type: 'UInt64' }],
  },
  functions: ['count', 'countIf', 'toDate'],
}

function at(sqlWithCursor: string, s: SqlSchema = schema) {
  const pos = sqlWithCursor.indexOf('|')
  const doc = sqlWithCursor.replace('|', '')
  return completeSql(doc, pos, s)
}

const labels = (r: ReturnType<typeof completeSql>) =>
  r?.options.map((o) => o.label) ?? []

describe('parseTableRefs', () => {
  test('reads qualified, bare and aliased tables, ignoring clause keywords', () => {
    expect(
      parseTableRefs(
        'SELECT * FROM system.query_log AS q JOIN events e ON 1 WHERE 1'
      )
    ).toEqual([
      { database: 'system', table: 'query_log', alias: 'q' },
      { database: 'default', table: 'events', alias: 'e' },
    ])
    expect(parseTableRefs('SELECT 1 FROM `system`.`tables` WHERE x')).toEqual([
      { database: 'system', table: 'tables', alias: undefined },
    ])
  })

  test('ignores FROM inside strings and comments', () => {
    expect(parseTableRefs("SELECT 'from x' -- FROM y\nFROM z")).toEqual([
      { database: 'default', table: 'z', alias: undefined },
    ])
  })
})

describe('completeSql', () => {
  test('db. lists that database tables', () => {
    const r = at('SELECT * FROM system.q|')
    expect(labels(r)).toEqual(['query_log', 'tables'])
    expect(r?.from).toBe('SELECT * FROM system.'.length)
  })

  test('db. on an unloaded database reports it missing instead of guessing', () => {
    const r = at('SELECT * FROM system.|', { ...schema, tables: {} })
    expect(r?.options).toEqual([])
    expect(r?.missing.tables).toEqual(['system'])
  })

  test('alias. resolves to the aliased table columns', () => {
    expect(labels(at('SELECT q.| FROM system.query_log q'))).toEqual([
      'query_id',
      'event_time',
    ])
  })

  test('table name as qualifier and db.table. both resolve columns', () => {
    expect(labels(at('SELECT query_log.| FROM system.query_log'))).toContain(
      'query_id'
    )
    expect(labels(at('SELECT system.query_log.|'))).toContain('event_time')
  })

  test('bare word ranks columns of FROM tables above functions and keywords', () => {
    const r = at('SELECT ev| FROM system.query_log')
    const opts = r?.options ?? []
    const col = opts.find((o) => o.label === 'event_time')
    const fn = opts.find((o) => o.label === 'count')
    const kw = opts.find((o) => o.label === 'SELECT')
    expect(col?.detail).toBe('DateTime')
    expect(col?.boost ?? 0).toBeGreaterThan(fn?.boost ?? 0)
    expect(fn?.boost ?? 0).toBeGreaterThan(kw?.boost ?? 0)
  })

  test('unloaded columns are reported missing so the editor can fetch them', () => {
    const r = at('SELECT x| FROM system.tables')
    expect(r?.missing.columns).toEqual([
      { database: 'system', table: 'tables' },
    ])
  })

  test('after FROM offers databases and default-db tables, not columns', () => {
    const r = labels(at('SELECT * FROM e|'))
    expect(r).toContain('system')
    expect(r).toContain('events')
    expect(r).not.toContain('count')
  })

  test('falls back to static functions when system.functions is unknown', () => {
    expect(
      labels(at('SELECT formatRead|', { ...schema, functions: null }))
    ).toContain('formatReadableSize')
  })

  test('no popup on whitespace or inside strings and comments', () => {
    expect(at('SELECT |')).toBeNull()
    expect(at("SELECT 'abc|'")).toBeNull()
    expect(at('SELECT 1 -- note|')).toBeNull()
  })
})
