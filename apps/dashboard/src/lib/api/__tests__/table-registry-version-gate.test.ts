/**
 * #3739: filter params whose field `since` is newer than the server are
 * ignored, so a stale `?client_agent=` never reaches a server without it.
 */
import type { FilterSchema } from '@/lib/filters/types'
import type { QueryConfig } from '@/lib/query-config'

import { getTableQuery, registerTableConfig } from '../table-registry'
import { describe, expect, test } from 'bun:test'
import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'

const schema = {
  fields: [
    {
      key: 'user',
      column: 'user',
      label: 'User',
      type: 'text',
      operators: ['eq'],
    },
    {
      key: 'client_agent',
      column: 'client_agent',
      label: 'Client agent',
      type: 'text',
      operators: ['eq'],
      since: '26.6',
    },
  ],
} as unknown as FilterSchema

function setup(name: string) {
  registerTableConfig({
    name,
    sql: `SELECT 1 FROM t WHERE 1 ${FILTER_PLACEHOLDER}`,
    columns: ['one'],
    filterSchema: schema,
  } as unknown as QueryConfig)
}

const searchParams = { client_agent: 'eq:claude', user: 'eq:bob' }

describe('getTableQuery serverVersion gate', () => {
  test('older server: no WHERE on the gated column, ungated kept', () => {
    setup('test:gate-old')
    const q = getTableQuery('test:gate-old', {
      hostId: 0,
      searchParams,
      serverVersion: '25.8.1.1',
    })
    const sql = String(q?.queryConfig.sql)
    expect(sql).not.toContain('client_agent')
    expect(sql).toContain('user')
  })

  test('unknown version (null) drops gated fields', () => {
    setup('test:gate-null')
    const q = getTableQuery('test:gate-null', {
      hostId: 0,
      searchParams,
      serverVersion: null,
    })
    expect(String(q?.queryConfig.sql)).not.toContain('client_agent')
  })

  test('26.6 applies the filter', () => {
    setup('test:gate-new')
    const q = getTableQuery('test:gate-new', {
      hostId: 0,
      searchParams,
      serverVersion: '26.6.1.1',
    })
    expect(String(q?.queryConfig.sql)).toContain('client_agent')
  })

  test('serverVersion omitted: no gating', () => {
    setup('test:gate-skip')
    const q = getTableQuery('test:gate-skip', { hostId: 0, searchParams })
    expect(String(q?.queryConfig.sql)).toContain('client_agent')
  })
})
