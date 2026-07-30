import { registerPrompts } from '../prompts'
import { createMcpServer } from '../server'
import { describe, expect, test } from 'bun:test'
import { McpServer } from '@modelcontextprotocol/server'

describe('registerPrompts', () => {
  test('registerPrompts completes without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerPrompts(server)).not.toThrow()
  })

  test('server with prompts creates successfully via createMcpServer', () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
  })
})
