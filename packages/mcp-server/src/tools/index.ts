import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerAdvisorTool } from './advisor'
import { registerDatabasesTool } from './databases'
import { registerExploreTableSchemaTool } from './explore-table-schema'
import { registerMergesTool } from './merges'
import { registerMetricsTool } from './metrics'
import { registerPerformanceTool } from './performance'
import { registerQueryTools } from './queries'
import { registerQueryTool } from './query'
import { registerTableTools } from './tables'

export function registerAllTools(server: McpServer) {
  registerQueryTool(server)
  registerDatabasesTool(server)
  registerTableTools(server)
  registerMetricsTool(server)
  registerQueryTools(server)
  registerMergesTool(server)
  registerExploreTableSchemaTool(server)
  registerPerformanceTool(server)
  registerAdvisorTool(server)
}
