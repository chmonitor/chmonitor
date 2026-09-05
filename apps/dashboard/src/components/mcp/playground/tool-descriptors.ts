import type { McpToolDescriptor } from '@/lib/mcp'

import { MCP_TOOLS } from '@chm/mcp-server/data'

/** Static catalog → discovered-tool shape, for the offline fallback. */
export function staticToolDescriptors(): McpToolDescriptor[] {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: tool.params.filter((p) => p.required).map((p) => p.name),
      properties: Object.fromEntries(
        tool.params.map((param) => [
          param.name,
          {
            type: param.type,
            description: param.description,
            ...(param.default !== undefined ? { default: param.default } : {}),
          },
        ])
      ),
    },
  }))
}
