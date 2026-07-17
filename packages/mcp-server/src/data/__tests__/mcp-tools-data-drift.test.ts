/**
 * Drift guard for issue #2701: `MCP_TOOLS` (the hand-maintained catalog behind
 * the `GET /api/v1/mcp/info` discovery endpoint and the dashboard's MCP
 * Playground / tool docs) must exactly match the tools actually registered on
 * the real MCP server by `registerAllTools()`.
 *
 * The catalog had drifted badly before this test existed: it advertised five
 * tools that did not exist anywhere on the server (`spot_issues`,
 * `repair_query`, `analyze_query_optimization`, `recommend_table_design`,
 * `discover_data_sources` — Playground calls to them were guaranteed dead),
 * and omitted two real ones (`analyze_performance`,
 * `get_optimization_recommendations` — undiscoverable from the UI).
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
