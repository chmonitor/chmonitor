import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerResources } from '../resources'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Resolves a resource URI the same way the SDK's internal
 * `ReadResourceRequestSchema` handler does: an exact match against
 * `_registeredResources`, falling back to the first `_registeredResourceTemplates`
 * entry whose `uriTemplate` matches. See
 * `@modelcontextprotocol/sdk`'s `server/mcp.js` `setResourceRequestHandlers`.
 */
async function readResource(server: McpServer, uriStr: string) {
  const uri = new URL(uriStr)
  const resources = (server as any)._registeredResources
  const exact = resources?.[uri.toString()]
  if (exact) return exact.readCallback(uri, {})

  const templates = (server as any)._registeredResourceTemplates
  for (const template of Object.values(templates ?? {}) as any[]) {
    const variables = template.resourceTemplate.uriTemplate.match(
      uri.toString()
    )
    if (variables) return template.readCallback(uri, variables, {})
  }
  throw new Error(`Resource ${uriStr} not found`)
}

describe('registerResources', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerResources(server)).not.toThrow()
  })

  describe('hostId support', () => {
    test('legacy URI without a hostId still resolves to host 0', async () => {
      mockFetchData.mockClear()
      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerResources(server)

      await readResource(server, 'clickhouse://databases/default/tables')

      expect(mockFetchData).toHaveBeenCalledTimes(1)
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 0 })
    })

    test('clickhouse://databases (no template) also defaults to host 0', async () => {
      mockFetchData.mockClear()
      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerResources(server)

      await readResource(server, 'clickhouse://databases')

      expect(mockFetchData).toHaveBeenCalledTimes(1)
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 0 })
    })

    test('clickhouse://hosts/{hostId}/databases/{database}/tables queries the requested host', async () => {
      mockFetchData.mockClear()
      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerResources(server)

      await readResource(
        server,
        'clickhouse://hosts/1/databases/default/tables'
      )

      expect(mockFetchData).toHaveBeenCalledTimes(1)
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 1 })
    })

    test('clickhouse://hosts/{hostId}/databases queries the requested host', async () => {
      mockFetchData.mockClear()
      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerResources(server)

      await readResource(server, 'clickhouse://hosts/2/databases')

      expect(mockFetchData).toHaveBeenCalledTimes(1)
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 2 })
    })

    test('table schema and parts resources thread hostId through as well', async () => {
      mockFetchData.mockClear()
      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerResources(server)

      await readResource(
        server,
        'clickhouse://hosts/3/databases/default/tables/events/schema'
      )
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 3 })

      mockFetchData.mockClear()
      await readResource(
        server,
        'clickhouse://hosts/3/databases/default/tables/events/parts'
      )
      expect(mockFetchData.mock.calls[0][0]).toMatchObject({ hostId: 3 })
    })
  })
})
