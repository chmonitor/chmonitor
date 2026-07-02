import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

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
  return Promise.resolve(input)
})

mock.module('../table-validator', () => ({
  validateTableExistence: mockValidateTableExistence,
}))

mock.module('../wasm/monitor-core', () => ({
  transformClickHouseJsonEachRowWasmJson:
    mockTransformClickHouseJsonEachRowWasmJson,
  transformClickHouseJsonEachRowWasm: async (input: string) =>
    JSON.parse(await mockTransformClickHouseJsonEachRowWasmJson(input)),
}))

// Clean up all module mocks after tests complete
afterAll(() => {
  mock.restore()
})

const { fetchData, fetchJsonEachRowAsNormalizedJson } = await import(
  new URL('../clickhouse/clickhouse-fetch.ts', import.meta.url).href
)

const { _resetEnvCache: resetEnvCache } = await import(
  '../clickhouse/env-schema'
)
const { clientPool } = await import('../clickhouse/connection-pool')

describe('clickhouse-fetch error parsing', () => {
  const originalEnv = { ...process.env }
  const mockClientQuery = mock(() => Promise.resolve({}))
  const mockClient = {
    query: mockClientQuery,
  }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    resetEnvCache()
    clientPool.clear()
    mockCreateClient.mockReset()
    mockClientQuery.mockReset()
    mockCreateClient.mockReturnValue(mockClient)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('fetchData status code parsing', () => {
    it('should ignore Code: XXX errors and not treat them as HTTP status codes', async () => {
      mockClientQuery.mockRejectedValue(
        new Error('ClickHouse exception: Code: 159, DB::Exception: ...')
      )
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBeUndefined()
    })

    it('should extract HTTP status code from HTTP error messages with status keyword', async () => {
      mockClientQuery.mockRejectedValue(new Error('Failed with status: 500'))
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBe(500)
    })

    it('should extract HTTP status code from HTTP/1.1 status error messages', async () => {
      mockClientQuery.mockRejectedValue(new Error('HTTP/1.1 403 Forbidden'))
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBe(403)
    })

    it('should extract HTTP status code from HTTP status keyword messages', async () => {
      mockClientQuery.mockRejectedValue(new Error('HTTP status 403'))
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBe(403)
    })

    it('should extract HTTP status code from status error messages without colon', async () => {
      mockClientQuery.mockRejectedValue(new Error('status 502 Bad Gateway'))
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBe(502)
    })

    it('should extract HTTP status code from HTTP/1.1 status line even when Code: is present', async () => {
      mockClientQuery.mockRejectedValue(
        new Error(
          'ClickHouse exception: Code: 159, DB::Exception: HTTP/1.1 500 Internal Server Error'
        )
      )
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBe(500)
    })

    it('should ignore port numbers or data quantities without HTTP context when Code: is present', async () => {
      mockClientQuery.mockRejectedValue(
        new Error(
          'ClickHouse exception: Code: 100, DB::Exception: connection error on port 8123'
        )
      )
      const result = await fetchData({ hostId: 0, query: 'SELECT 1' })
      expect(result.error?.details?.httpStatusCode).toBeUndefined()
    })
  })

  describe('fetchJsonEachRowAsNormalizedJson status code parsing', () => {
    it('should ignore Code: XXX errors and not treat them as HTTP status codes', async () => {
      mockClientQuery.mockRejectedValue(
        new Error('ClickHouse exception: Code: 159, DB::Exception: ...')
      )
      const result = await fetchJsonEachRowAsNormalizedJson({
        hostId: 0,
        query: 'SELECT 1',
      })
      expect(result.error?.details?.httpStatusCode).toBeUndefined()
    })

    it('should extract HTTP status code from HTTP error messages with status keyword', async () => {
      mockClientQuery.mockRejectedValue(new Error('Failed with status: 500'))
      const result = await fetchJsonEachRowAsNormalizedJson({
        hostId: 0,
        query: 'SELECT 1',
      })
      expect(result.error?.details?.httpStatusCode).toBe(500)
    })

    it('should extract HTTP status code from HTTP/1.1 status error messages', async () => {
      mockClientQuery.mockRejectedValue(new Error('HTTP status 403'))
      const result = await fetchJsonEachRowAsNormalizedJson({
        hostId: 0,
        query: 'SELECT 1',
      })
      expect(result.error?.details?.httpStatusCode).toBe(403)
    })
  })
})
