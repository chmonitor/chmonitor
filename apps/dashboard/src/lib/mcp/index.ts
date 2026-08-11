/** Playground MCP client + schema→form mapping. */

import type { McpToolDescriptor } from './playground-client'

import { buildSchemaForm, type SchemaForm } from './schema-form'

export * from './playground-client'
export * from './schema-form'

/** Convenience: build the form model straight from a discovered tool. */
export function buildSchemaFormForTool(tool: McpToolDescriptor): SchemaForm {
  return buildSchemaForm(tool.inputSchema)
}
