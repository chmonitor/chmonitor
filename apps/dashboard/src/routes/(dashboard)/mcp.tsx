import { FileCode2, Globe, Lock, Zap } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { MCP_TOOLS } from '@chm/mcp-server/data'
import { McpEndpointUrl } from '@/components/mcp/mcp-endpoint-url'
import { McpExamplePrompts } from '@/components/mcp/mcp-example-prompts'
import { McpPlayground } from '@/components/mcp/mcp-playground'
import { McpSetupGuides } from '@/components/mcp/mcp-setup-guides'
import { McpToolsDocs } from '@/components/mcp/mcp-tools-docs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MCP_PROTOCOL_VERSION } from '@/lib/mcp'

/**
 * One labeled fact about the endpoint. Label on top, value below, so the row
 * reads as a stat strip rather than three anonymous pills.
 */
function EndpointStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-[13px] font-medium">{value}</p>
      </div>
    </div>
  )
}

function McpPage() {
  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">MCP Server</h1>
          <Badge variant="secondary" className="text-xs">
            Model Context Protocol
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Connect AI assistants like Claude, Cursor, and other MCP-compatible
          clients directly to your ClickHouse cluster. Query data, explore
          schemas, and investigate performance, all through natural language.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <EndpointStat
            icon={<Globe className="size-3.5" />}
            label="Transport"
            value="Streamable HTTP"
          />
          <EndpointStat
            icon={<FileCode2 className="size-3.5" />}
            label="Protocol"
            value={MCP_PROTOCOL_VERSION}
          />
          <EndpointStat
            icon={<Lock className="size-3.5" />}
            label="Access"
            value="Read-only"
          />
          <EndpointStat
            icon={<Zap className="size-3.5" />}
            label="Tools"
            value={`${MCP_TOOLS.length} available`}
          />
        </div>
      </div>

      {/* Endpoint URL — always visible */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Endpoint URL
            </p>
            <McpEndpointUrl />
          </div>
        </CardContent>
      </Card>

      {/* Main tabbed content */}
      <Tabs defaultValue="setup">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="setup" className="text-xs flex-1 sm:flex-none">
            Setup Guides
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-xs flex-1 sm:flex-none">
            Tools
          </TabsTrigger>
          <TabsTrigger
            value="playground"
            className="text-xs flex-1 sm:flex-none"
          >
            Playground
          </TabsTrigger>
          <TabsTrigger value="prompts" className="text-xs flex-1 sm:flex-none">
            Example Prompts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <McpSetupGuides />
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <McpToolsDocs />
        </TabsContent>

        <TabsContent value="playground" className="mt-4">
          <McpPlayground />
        </TabsContent>

        <TabsContent value="prompts" className="mt-4">
          <McpExamplePrompts />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/mcp')({
  component: McpPage,
})
