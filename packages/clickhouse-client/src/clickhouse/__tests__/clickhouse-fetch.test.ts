/**
 * Tests for lib/clickhouse/clickhouse-fetch.ts
 */

import type { QueryConfigLike } from '@chm/sql-builder'

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'

// Mock dependencies — all mock.module calls are hoisted by bun before imports.
// We use dynamic import (await import) instead of static import to guarantee
// the import resolves AFTER mock.module takes effect. Static imports are also
// hoisted by ESM and can race with mock.module on Linux CI.
const mockDebug = mock(() => {})
const mockError = mock(() => {})
const mockWarn = mock(() => {})
const mockIsDebugEnabled = mock(() => false)

mock.module('@chm/logger', () => ({
  debug: mockDebug,
  error: mockError,
  warn: mockWarn,
  isDebugEnabled: mockIsDebugEnabled,
}))

// Mock @clickhouse/client and @clickhouse/client-web at the package level so
// the real getClient() in clickhouse-client.ts creates a mock client regardless
// of which branch (web vs node) is selected. getClient() defaults to the web
// client (web !== false), so the web mock is the one that fires in fetchData.
const mockCreateClient = mock(() => ({}))
mock.module('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}))
mock.module('@clickhouse/client-web', () => ({
  createClient: mockCreateClient,
}))

const mockValidateTableExistence = mock(() =>
  Promise.resolve({ shouldProceed: true, missingTables: [] })
)
const mockTransformClickHouseJsonEachRowWasmJson = mock((input: string) => {
  const rows = input
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))

  return Promise.resolve(JSON.stringify(normalizeNumericStrings(rows)))
})

function normalizeNumericStrings(value: unknown): unknown {
  if (
    typeof value === 'string' &&
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)
  ) {
    const number = Number(value)
    return Number.isInteger(number) &&
      Math.abs(number) > Number.MAX_SAFE_INTEGER
      ? value
      : number
  }

  if (Array.isArray(value)) {
    return value.map(normalizeNumericStrings)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeNumericStrings(item),
      ])
    )
  }

  return value
}

// Mock specifiers MUST match the import specifiers in clickhouse-fetch.ts.
// On Linux CI, bun's mock.module only intercepts imports with matching specifiers.
mock.module('../../table-validator', () => ({
  validateTableExistence: mockValidateTableExistence,
}))

mock.module('../../wasm/monitor-core', () => ({
  transformClickHouseJsonEachRowWasmJson:
    mockTransformClickHouseJsonEachRowWasmJson,
  transformClickHouseJsonEachRowWasm: async (input: string) =>
    JSON.parse(await mockTransformClickHouseJsonEachRowWasmJson(input)),
}))

// Clean up all module mocks after tests complete
afterAll(() => {
  mock.restore()
})

// Dynamic import ensures mocks are in place before the module loads.
// The cache-busting query keeps this test isolated from earlier module loads
// in Bun's shared test process.
const {
  __testCountJsonEachRowRows,
  fetchData,
  fetchJsonEachRowAsNormalizedJson,
} = await import(
  new URL('../clickhouse-fetch.ts?test=clickhouse-fetch', import.meta.url).href
)

// Import env cache reset and connection pool for test isolation.
// These target the canonical (non-query-string) instances that clickhouse-fetch
// uses internally via clickhouse-client -> clickhouse-config -> env-schema.
const { _resetEnvCache: resetEnvCache } = await import('../env-schema')
const { clientPool } = await import('../connection-pool')

describe('clickhouse-fetch', () => {
  const originalEnv = { ...process.env }

  const mockClientQuery = mock(() => Promise.resolve({}))
  const mockResultSetJson = mock(() => Promise.resolve([{ result: 'data' }]))
  const mockResultSetText = mock(() =>
    Promise.resolve('{"result":"1"}\n{"result":"2"}\n')
  )

  const mockClient = {
    query: mockClientQuery,
  }

  const mockResultSet = {
    query_id: 'test-query-id',
    json: mockResultSetJson,
    text: mockResultSetText,
  }

  const defaultParams = {
    query: 'SELECT 1',
    hostId: 0,
  }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    resetEnvCache()
    clientPool.clear()
    mockCreateClient.mockReset()
    mockValidateTableExistence.mockReset()
    mockClientQuery.mockReset()
    mockResultSetJson.mockReset()
    mockResultSetText.mockReset()
    mockDebug.mockReset()
    mockError.mockReset()
    mockWarn.mockReset()
    mockTransformClickHouseJsonEachRowWasmJson.mockClear()

    mockCreateClient.mockReturnValue(mockClient)
    mockResultSetJson.mockResolvedValue([{ result: 'data' }])
    mockResultSetText.mockResolvedValue('{"result":"1"}\n{"result":"2"}\n')
    mockClientQuery.mockResolvedValue(mockResultSet as never)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('fetchData', () => {
    describe('successful query execution', () => {
      it('should return data and metadata on success', async () => {
        const result = await fetchData(defaultParams)

        expect(result.data).toEqual([{ result: 'data' }])
        expect(result.metadata).toMatchObject({
          queryId: 'test-query-id',
          duration: expect.any(Number),
          rows: 1,
          host: 'http://localhost:8123',
          sql: 'SELECT 1',
        })
        expect(result.metadata.clickhouseVersion).toBeDefined()
        expect(result.metadata.rawResponseLength).toBeGreaterThan(0)
        expect(result.metadata.rawResponsePreview).toBeDefined()
        expect(result.error).toBeUndefined()
      })

      it('does not include readBytes when the result set has no response_headers', async () => {
        // The shared mockResultSet (default beforeEach setup) carries no
        // response_headers, matching most existing test stubs.
        const result = await fetchData(defaultParams)
        expect(result.metadata.readBytes).toBeUndefined()
      })

      it('includes readBytes parsed from the X-ClickHouse-Summary header', async () => {
        mockClientQuery.mockResolvedValueOnce({
          ...mockResultSet,
          response_headers: {
            'x-clickhouse-summary': JSON.stringify({ read_bytes: '2048' }),
          },
        } as never)

        const result = await fetchData(defaultParams)
        expect(result.metadata.readBytes).toBe(2048)
      })

      it('omits readBytes when the summary header is present but unparseable', async () => {
        mockClientQuery.mockResolvedValueOnce({
          ...mockResultSet,
          response_headers: { 'x-clickhouse-summary': 'not-json' },
        } as never)

        const result = await fetchData(defaultParams)
        expect(result.metadata.readBytes).toBeUndefined()
      })

      it('does not JSON.stringify the result set when debug is disabled', async () => {
        // isDebugEnabled() is mocked false (simulating DEBUG unset / prod).
        const mockData = [{ big: 'payload' }]
        mockResultSetJson.mockResolvedValue(mockData)

        const stringifySpy = spyOn(JSON, 'stringify')
        try {
          const result = await fetchData(defaultParams)
          // The parsed result set must never be serialized while debug is off
          // and the lazy rawResponse* getters are untouched.
          const serializedResultSet = stringifySpy.mock.calls.some(
            (call) => call[0] === result.data
          )
          expect(serializedResultSet).toBe(false)
        } finally {
          stringifySpy.mockRestore()
        }
      })

      it('should handle array data', async () => {
        const mockData = [
          { col1: 'val1', col2: 100 },
          { col1: 'val2', col2: 200 },
        ]
        mockResultSetJson.mockResolvedValue(mockData)

        const result = await fetchData(defaultParams)

        expect(result.data).toEqual(mockData)
        expect(result.metadata.rows).toBe(2)
      })

      it('should handle null data', async () => {
        mockResultSetJson.mockResolvedValue(null)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.metadata.rows).toBe(-1)
      })

      it('should handle object data with rows property', async () => {
        const mockData = {
          rows: 100,
          statistics: { read_rows: 1000 },
        }
        mockResultSetJson.mockResolvedValue(mockData)

        const result = await fetchData(defaultParams)

        expect(result.data).toEqual(mockData)
        expect(result.metadata.rows).toBe(100)
      })

      it('should use queryConfig.sql when provided', async () => {
        const queryConfig: QueryConfigLike = {
          name: 'test',
          sql: 'SELECT 2',
        } as QueryConfigLike

        await fetchData({ ...defaultParams, queryConfig })

        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining('SELECT 2'),
          })
        )
      })

      it('should use direct query when queryConfig not provided', async () => {
        await fetchData({ query: 'SELECT 3', hostId: 0 })

        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.stringContaining('SELECT 3'),
          })
        )
      })

      it('should pass query_params to client', async () => {
        const queryParams = { param1: 'value1', param2: 100 }
        await fetchData({ ...defaultParams, query_params: queryParams })

        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query_params: queryParams,
          })
        )
      })

      it('should pass clickhouse_settings to client', async () => {
        const settings = { max_execution_time: 60 }
        await fetchData({
          ...defaultParams,
          clickhouse_settings: settings,
        })

        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            clickhouse_settings: settings,
          })
        )
      })

      it('should support different formats', async () => {
        await fetchData({ ...defaultParams, format: 'JSON' })

        expect(mockClientQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            format: 'JSON',
          })
        )
      })
    })

    describe('hostId validation', () => {
      it('should throw for invalid hostId (NaN)', async () => {
        await expect(
          fetchData({
            ...defaultParams,
            hostId: 'invalid' as unknown as number,
          })
        ).rejects.toThrow('Invalid hostId')
      })

      it('should accept numeric string hostId that exists', async () => {
        const result = await fetchData({
          ...defaultParams,
          hostId: '0' as unknown as number,
        })

        expect(result.error).toBeUndefined()
      })

      it('should accept number hostId that exists', async () => {
        const result = await fetchData({ ...defaultParams, hostId: 0 })

        expect(result.error).toBeUndefined()
      })
    })

    describe('configuration validation', () => {
      it('should return error when no configs available', async () => {
        delete process.env.CLICKHOUSE_HOST
        resetEnvCache()

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error).toBeDefined()
        expect(result.error?.type).toBe('validation_error')
        expect(result.error?.message).toContain(
          'No ClickHouse hosts configured'
        )
      })

      it('should return error when hostId out of range', async () => {
        const result = await fetchData({ ...defaultParams, hostId: 5 })

        expect(result.data).toBeNull()
        expect(result.error).toBeDefined()
        expect(result.error?.type).toBe('validation_error')
        expect(result.error?.message).toContain('Invalid hostId: 5')
        expect(result.error?.message).toContain('Available hosts: 0')
      })
    })

    describe('optional query validation', () => {
      it('should validate tables when queryConfig.optional is true', async () => {
        const queryConfig: QueryConfigLike = {
          name: 'test',
          sql: 'SELECT * FROM system.backup_log',
          optional: true,
        } as QueryConfigLike

        mockValidateTableExistence.mockResolvedValue({
          shouldProceed: true,
          missingTables: [],
        })

        await fetchData({ ...defaultParams, queryConfig })

        expect(mockValidateTableExistence).toHaveBeenCalledWith(queryConfig, 0)
      })

      it('should skip query when validation fails', async () => {
        const queryConfig: QueryConfigLike = {
          name: 'test',
          sql: 'SELECT * FROM system.backup_log',
          optional: true,
        } as QueryConfigLike

        mockValidateTableExistence.mockResolvedValue({
          shouldProceed: false,
          missingTables: ['system.backup_log'],
          error: 'Table not found',
        })

        const result = await fetchData({ ...defaultParams, queryConfig })

        expect(result.data).toBeNull()
        expect(result.error).toBeDefined()
        expect(result.error?.type).toBe('table_not_found')
        expect(result.error?.message).toContain('Table not found')
        expect(mockClientQuery).not.toHaveBeenCalled()
      })

      it('should not validate when queryConfig.optional is false', async () => {
        const queryConfig: QueryConfigLike = {
          name: 'test',
          sql: 'SELECT 1',
          optional: false,
        } as QueryConfigLike

        await fetchData({ ...defaultParams, queryConfig })

        expect(mockValidateTableExistence).not.toHaveBeenCalled()
        expect(mockClientQuery).toHaveBeenCalled()
      })

      it('should not validate when queryConfig not provided', async () => {
        await fetchData(defaultParams)

        expect(mockValidateTableExistence).not.toHaveBeenCalled()
      })

      it('should include missingTables in error details', async () => {
        const queryConfig: QueryConfigLike = {
          name: 'test',
          sql: 'SELECT * FROM system.backup_log',
          optional: true,
        } as QueryConfigLike

        mockValidateTableExistence.mockResolvedValue({
          shouldProceed: false,
          missingTables: ['system.backup_log', 'system.error_log'],
        })

        const result = await fetchData({ ...defaultParams, queryConfig })

        expect(result.error?.details?.missingTables).toEqual([
          'system.backup_log',
          'system.error_log',
        ])
      })
    })

    describe('error handling', () => {
      it('should classify table_not_found errors', async () => {
        const error = new Error("Table system.unknown_table doesn't exist")
        mockClientQuery.mockRejectedValue(error)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error?.message).toContain("doesn't exist")
      })

      it('should classify permission errors', async () => {
        const error = new Error('Permission denied')
        mockClientQuery.mockRejectedValue(error)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error?.type).toBe('permission_error')
      })

      it('should classify network errors', async () => {
        const error = new Error('Network connection failed')
        mockClientQuery.mockRejectedValue(error)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error?.type).toBe('network_error')
      })

      it('should default to query_error for unknown errors', async () => {
        const error = new Error('Unknown error')
        mockClientQuery.mockRejectedValue(error)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error?.type).toBe('query_error')
      })

      it('should include original error in details', async () => {
        const originalError = new Error('Test error')
        mockClientQuery.mockRejectedValue(originalError)

        const result = await fetchData(defaultParams)

        expect(result.error?.details?.originalError).toBe(originalError)
      })

      it('should handle non-Error errors', async () => {
        mockClientQuery.mockRejectedValue('String error')

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
        expect(result.error?.message).toContain('String error')
        expect(result.error?.details?.originalError).toBeUndefined()
      })

      it('should include host in error details', async () => {
        mockClientQuery.mockRejectedValue(new Error('Test error'))

        const result = await fetchData(defaultParams)

        expect(result.error?.details?.host).toBe('http://localhost:8123')
      })

      it('should return metadata on error', async () => {
        mockClientQuery.mockRejectedValue(new Error('Test error'))

        const result = await fetchData(defaultParams)

        expect(result.metadata).toEqual({
          queryId: '',
          duration: expect.any(Number),
          rows: 0,
          host: 'http://localhost:8123',
        })
      })
    })

    describe('metadata calculation', () => {
      it('should calculate duration correctly', async () => {
        const result = await fetchData(defaultParams)

        expect(result.metadata.duration).toBeGreaterThanOrEqual(0)
        expect(result.metadata.duration).toBeLessThan(1)
      })

      it('should include query_id from result set', async () => {
        const result = await fetchData(defaultParams)

        expect(result.metadata.queryId).toBe('test-query-id')
      })

      it('should include host from config', async () => {
        const result = await fetchData(defaultParams)

        expect(result.metadata.host).toBe('http://localhost:8123')
      })
    })

    describe('error type classification edge cases', () => {
      it('should handle case insensitive error messages', async () => {
        mockClientQuery.mockRejectedValue(new Error('TABLE NOT FOUND'))

        const result = await fetchData(defaultParams)

        expect(result.error?.type).toBe('query_error')
      })

      it('should handle errors with multiple keywords', async () => {
        mockClientQuery.mockRejectedValue(
          new Error('Table not found and permission denied')
        )

        const result = await fetchData(defaultParams)

        expect(result.error?.type).toBe('permission_error')
      })

      it('should handle empty error message', async () => {
        mockClientQuery.mockRejectedValue(new Error(''))

        const result = await fetchData(defaultParams)

        expect(result.error?.type).toBe('query_error')
      })
    })

    describe('type safety', () => {
      it('should return correct type for array data', async () => {
        mockResultSetJson.mockResolvedValue([{ col: 'val' }])

        const result = await fetchData(defaultParams)

        expect(Array.isArray(result.data)).toBe(true)
      })

      it('should return correct type for object data', async () => {
        const mockData = {
          rows: 10,
          statistics: { read_rows: 100 },
        }
        mockResultSetJson.mockResolvedValue(mockData)

        const result = await fetchData(defaultParams)

        expect(typeof result.data).toBe('object')
      })

      it('should return null type for null data', async () => {
        mockResultSetJson.mockResolvedValue(null)

        const result = await fetchData(defaultParams)

        expect(result.data).toBeNull()
      })
    })
  })

  describe('fetchJsonEachRowAsNormalizedJson', () => {
    it('returns normalized JSON without parsing rows into JS objects', async () => {
      mockResultSetText.mockResolvedValue(
        '{"result":"001","max":"9007199254740992"}\n{"result":"2"}\n'
      )

      const result = await fetchJsonEachRowAsNormalizedJson(defaultParams)

      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'JSONEachRow',
        })
      )
      expect(mockResultSetJson).not.toHaveBeenCalled()
      expect(result.data).toBeNull()
      expect(result.dataJson).toBe(
        '[{"result":1,"max":"9007199254740992"},{"result":2}]'
      )
      expect(result.metadata.rows).toBe(2)
      expect(result.metadata.rawResponseLength).toBeGreaterThan(0)
    })

    it('counts JSONEachRow rows without allocating line arrays', () => {
      expect(__testCountJsonEachRowRows('')).toBe(0)
      expect(__testCountJsonEachRowRows('\n  \n\t\n')).toBe(0)
      expect(__testCountJsonEachRowRows('{"a":1}\n{"a":2}\n')).toBe(2)
      expect(__testCountJsonEachRowRows('{"a":1}\n\n{"a":2}')).toBe(2)
    })

    it('executes the version-selected sql from a versioned queryConfig.sql[], not the raw query arg', async () => {
      // Single-entry array is always selected regardless of detected version,
      // so this asserts the helper honors queryConfig.sql[] (mirroring fetchData)
      // rather than silently running the raw `query` argument.
      const queryConfig: QueryConfigLike = {
        name: 'versioned',
        sql: [{ since: '1.0', sql: 'SELECT only_variant' }],
      } as QueryConfigLike

      const result = await fetchJsonEachRowAsNormalizedJson({
        ...defaultParams,
        query: 'SELECT raw_ignored',
        queryConfig,
      })

      const executed = mockClientQuery.mock.calls.map((c) => c[0].query)
      expect(
        executed.some((q: string) => q.includes('SELECT only_variant'))
      ).toBe(true)
      expect(executed.some((q: string) => q.includes('raw_ignored'))).toBe(
        false
      )
      // metadata.sql should also reflect the executed (selected) query
      expect(result.metadata.sql).toContain('SELECT only_variant')
    })
  })
})
