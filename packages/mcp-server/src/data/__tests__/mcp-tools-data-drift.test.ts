/**
 * `MCP_TOOLS` (the hand-maintained catalog behind `GET /api/v1/mcp/info`) must
 * exactly match the tools registered by `registerAllTools()`.
 */

import { createMcpServer } from '../../server'
import { MCP_TOOLS } from '../mcp-tools-data'
import { describe, expect, test } from 'bun:test'

function registeredToolNames(): string[] {
  // The MCP SDK keeps registrations in `_registeredTools` (name → tool).
  // Internal, but stable across the SDK versions this package pins, and the
  // only introspection surface that doesn't require a connected transport.
  const server = createMcpServer() as unknown as {
    _registeredTools?: Record<string, unknown>
  }
  const tools = server._registeredTools
  if (!tools || Object.keys(tools).length === 0) {
    throw new Error(
      'Could not introspect registered tools — the MCP SDK may have renamed ' +
        '_registeredTools; update this test rather than deleting it.'
    )
  }
  return Object.keys(tools).sort()
}

describe('MCP_TOOLS catalog ↔ registered tools consistency (#2701)', () => {
  test('the advertised tool set is exactly the registered tool set', () => {
    const advertised = MCP_TOOLS.map((t) => t.name).sort()
    const registered = registeredToolNames()
    expect(advertised).toEqual(registered)
  })

  test('the catalog has no duplicate tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
