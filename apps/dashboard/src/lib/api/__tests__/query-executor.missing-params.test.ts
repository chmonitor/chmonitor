/**
 * #3918 — a table config whose SQL needs a `{name:Type}` param the caller did
 * not send (e.g. `columns` without `database`) must fail as a validation_error
 * (HTTP 400) before reaching ClickHouse, not as a 500 UNKNOWN_QUERY_PARAMETER.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const mockFetchData = mock(async () => ({
  data: [],
  metadata: { queryId: 'q', duration: 0, rows: 0, host: 'h' },
  error: undefined,
}))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
  fetchJsonEachRowAsNormalizedJson: mock(async () => ({})),
  getClient: async () => ({ query: async () => ({}) }),
}))

const realClickHouseVersion = await import(
  '@chm/clickhouse-client/clickhouse-version'
)
mock.module('@chm/clickhouse-client/clickhouse-version', () => ({
  ...realClickHouseVersion,
  getClickHouseVersion: async () => ({
    major: 26,
    minor: 5,
    patch: 0,
    raw: '26.5.0',
  }),
}))

const { executeTableConfig, findMissingQueryParams } = await import(
  '@/lib/api/query-executor'
)
const { statusForFetchDataError } = await import(
  '@/lib/api/shared/fetch-data-error'
)

const COLUMNS_SQL = `SELECT name FROM system.columns
  WHERE database = {database:String} AND table = {table: String}
    AND format('{}:{}', name, type) != ''`

describe('findMissingQueryParams', () => {
  test('names every placeholder without a value, once', () => {
    expect(
      findMissingQueryParams(`${COLUMNS_SQL} OR table = {table:String}`, {})
    ).toEqual(['database', 'table'])
  })

  test('treats null and undefined as missing but an empty string as given', () => {
    expect(
      findMissingQueryParams(COLUMNS_SQL, { database: null, table: '' })
    ).toEqual(['database'])
  })

  test('ignores format() braces and SQL without placeholders', () => {
    expect(
      findMissingQueryParams(COLUMNS_SQL, { database: 'd', table: 't' })
    ).toEqual([])
    expect(findMissingQueryParams('SELECT 1', undefined)).toEqual([])
  })
})

describe('executeTableConfig with a missing required param', () => {
  beforeEach(() => mockFetchData.mockClear())

  test('returns a 400 validation_error and never queries ClickHouse', async () => {
    const { result } = await executeTableConfig(
      { name: 'columns', sql: COLUMNS_SQL, columns: [] },
      0,
      { table: 't' }
    )

    expect(mockFetchData).not.toHaveBeenCalled()
    expect(result.error?.type).toBe('validation_error')
    expect(result.error?.message).toBe(
      'Missing required parameter(s): database'
    )
    expect(statusForFetchDataError(result.error!.type)).toBe(400)
  })

  test('checks the version-selected SQL, not an older variant', async () => {
    await executeTableConfig(
      {
        name: 'v',
        sql: [
          { since: '23.8', sql: 'SELECT {cluster:String}' },
          { since: '24.1', sql: 'SELECT 1' },
        ],
        columns: [],
      },
      0,
      undefined
    )

    expect(mockFetchData).toHaveBeenCalledTimes(1)
  })
})
