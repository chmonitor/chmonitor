import { createMcpServer } from '../server'
import { describe, expect, test } from 'bun:test'

describe('MCP Server', () => {
  test('creates server instance with tools/resources/prompts registered', () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
    // registerTool / registerResource / registerPrompt populate these records
    const s = server as unknown as {
      _registeredTools: Record<string, unknown>
      _registeredResources: Record<string, unknown>
      _registeredPrompts: Record<string, unknown>
    }
    expect(Object.keys(s._registeredTools).length).toBeGreaterThan(0)
    expect(Object.keys(s._registeredResources).length).toBeGreaterThan(0)
    expect(Object.keys(s._registeredPrompts).length).toBeGreaterThan(0)
  })
})
