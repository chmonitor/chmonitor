import { registerPrompts } from './prompts'
import { registerResources } from './resources'
import { registerAllTools } from './tools'
import { McpServer } from '@modelcontextprotocol/server'

export function createMcpServer() {
  const server = new McpServer({
    name: 'clickhouse-monitor',
    version: '1.0.0',
  })

  registerAllTools(server)
  registerResources(server)
  registerPrompts(server)

  return server
}
