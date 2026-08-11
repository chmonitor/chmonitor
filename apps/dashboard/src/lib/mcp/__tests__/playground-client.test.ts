import {
  buildJsonRpcRequest,
  buildMcpHeaders,
  buildSchemaFormForTool,
  errorKindForStatus,
  listTools,
  MCP_PROTOCOL_VERSION,
  McpRequestError,
  parseMcpBody,
  resultText,
} from '../index'
import { beforeAll, describe, expect, it } from 'bun:test'

describe('buildJsonRpcRequest', () => {
  it('declares the protocol version in _meta (no initialize handshake)', () => {
    const req = buildJsonRpcRequest('tools/call', { name: 'query' }) as {
      params: { _meta: Record<string, unknown>; name: string }
    }
    expect(req.params.name).toBe('query')
    expect(req.params._meta['io.modelcontextprotocol/protocolVersion']).toBe(
      MCP_PROTOCOL_VERSION
    )
  })
})

describe('buildMcpHeaders', () => {
  it('sends the headers 2026-07-28 requires on a Streamable HTTP POST', () => {
    const headers = buildMcpHeaders({ method: 'tools/call', name: 'query' })
    expect(headers['Mcp-Method']).toBe('tools/call')
    expect(headers['Mcp-Name']).toBe('query')
    expect(headers['MCP-Protocol-Version']).toBe(MCP_PROTOCOL_VERSION)
    expect(headers.Accept).toContain('text/event-stream')
  })

  it('omits Mcp-Name for methods that address no named entity', () => {
    expect(
      buildMcpHeaders({ method: 'tools/list' })['Mcp-Name']
    ).toBeUndefined()
  })

  it('presents an API key as both x-api-key and a bearer token', () => {
    const headers = buildMcpHeaders({ method: 'tools/list', apiKey: 'k' })
    expect(headers['x-api-key']).toBe('k')
    expect(headers.Authorization).toBe('Bearer k')
  })
})

describe('parseMcpBody', () => {
  it('parses a plain JSON response', () => {
    expect(parseMcpBody('application/json', '{"result":{"tools":[]}}')).toEqual(
      {
        result: { tools: [] },
      }
    )
  })

  it('takes the JSON-RPC response out of an SSE stream, skipping notifications', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      '',
    ].join('\n')
    expect(parseMcpBody('text/event-stream', body)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    })
  })

  it('throws a protocol error on a non-JSON body', () => {
    expect(() => parseMcpBody('text/html', '<html>oops</html>')).toThrow(
      McpRequestError
    )
  })
})

describe('errorKindForStatus', () => {
  it('separates the failure shapes the Playground reacts to', () => {
    // 401 = auth posture (offer the API-key input); 402/403 = plan gate;
    // 429 = rate limiter. Each needs a different message, not a raw failure.
    expect(errorKindForStatus(401)).toBe('unauthorized')
    expect(errorKindForStatus(402)).toBe('payment_required')
    expect(errorKindForStatus(403)).toBe('forbidden')
    expect(errorKindForStatus(429)).toBe('rate_limited')
    expect(errorKindForStatus(500)).toBe('network')
  })
})

describe('resultText', () => {
  it('joins text blocks and ignores non-text content', () => {
    expect(
      resultText({
        content: [
          { type: 'text', text: 'a' },
          { type: 'image', data: 'x' },
          { type: 'text', text: 'b' },
        ],
      })
    ).toBe('a\nb')
  })
})

/**
 * End-to-end against the REAL server handler.
 *
 * The Playground's request shape is only correct if our own `handleMcp` accepts
 * it, so drive the actual handler in-process rather than a mock: this is what
 * catches a wrong header name or envelope before it ships. `tools/list` needs
 * no ClickHouse connection.
 */
describe('listTools against handleMcp', () => {
  beforeAll(() => {
    process.env.CHM_MCP_PUBLIC = 'true'
  })

  it('discovers the real tool catalog with usable input schemas', async () => {
    const { handleMcp } = await import('@chm/mcp-server/http')
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((input: Request | string, init?: RequestInit) =>
      handleMcp(
        new Request(typeof input === 'string' ? input : input.url, init)
      )) as typeof fetch

    try {
      const { tools, exchange } = await listTools({
        endpoint: 'https://example.test/api/mcp',
      })

      expect(exchange.status).toBe(200)
      expect(tools.length).toBeGreaterThan(0)

      const query = tools.find((tool) => tool.name === 'query')
      expect(query).toBeDefined()
      // Every tool on this server is read-only — the badge in the Tools tab
      // reads this annotation rather than hardcoding it.
      expect(query?.annotations?.readOnlyHint).toBe(true)

      const form = buildSchemaFormForTool(query!)
      expect(form.fields.find((f) => f.name === 'sql')).toMatchObject({
        kind: 'string',
        required: true,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
