import { alignDdlLines } from './ddl-diff'
import { prettySchemaSql } from './pretty-sql'
import { describe, expect, test } from 'bun:test'

describe('alignDdlLines', () => {
  test('marks identical pretty DDL as equal rows with line numbers', () => {
    const sql = prettySchemaSql(
      'CREATE TABLE app.users (id UInt64) ENGINE = MergeTree ORDER BY id'
    )
    const rows = alignDdlLines(sql, sql)
    expect(rows.every((row) => row.op === 'equal')).toBe(true)
    expect(rows.map((row) => row.left?.no)).toEqual(rows.map((_, i) => i + 1))
    expect(rows[0]?.left?.text).toBe('CREATE TABLE app.users')
  })

  test('highlights a changed column as replace', () => {
    const source = prettySchemaSql(
      'CREATE TABLE app.events (id UInt64) ENGINE = MergeTree ORDER BY id'
    )
    const target = prettySchemaSql(
      'CREATE TABLE app.events (id UInt32) ENGINE = MergeTree ORDER BY id'
    )
    const rows = alignDdlLines(source, target)
    const changed = rows.filter((row) => row.op !== 'equal')
    expect(changed).toEqual([
      {
        op: 'replace',
        left: { no: 3, text: '  id UInt64' },
        right: { no: 3, text: '  id UInt32' },
      },
    ])
  })

  test('treats missing source as inserts', () => {
    const rows = alignDdlLines('', 'CREATE TABLE t (id UInt64)')
    expect(rows).toEqual([
      {
        op: 'insert',
        left: null,
        right: { no: 1, text: 'CREATE TABLE t (id UInt64)' },
      },
    ])
  })
})
