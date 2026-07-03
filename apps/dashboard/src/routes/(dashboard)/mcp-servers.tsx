import { createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '@/components/layout/page-header'
import { McpServerManager } from '@/components/mcp/mcp-server-manager'

function McpServersPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="MCP servers"
        description="Register external Model Context Protocol servers. Their tools load alongside the agent's built-in tools at the start of every conversation."
      />
      <McpServerManager />
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/mcp-servers')({
  component: McpServersPage,
})
