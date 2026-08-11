import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MousePointerClick,
  Plug,
  Terminal,
} from 'lucide-react'

import { CodeBlock, CopyButton } from './copy-button'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { buildJsonRpcRequest, MCP_PROTOCOL_VERSION } from '@/lib/mcp'
import { cn } from '@/lib/utils'

interface SetupGuide {
  id: string
  name: string
  description: string
  /** Lucide glyph standing in for the client — no new icon dependency. */
  icon: React.ComponentType<{ className?: string }>
  /** Where the config lives, e.g. "macOS · Windows" or "CLI". */
  platform: string
  /** How the client connects, e.g. "Streamable HTTP". */
  transport: string
  /**
   * The single snippet a user most likely wants (config JSON or the add
   * command). Surfaced as a copy button on the collapsed row so the common
   * case needs no expand.
   */
  quickCopy: string
  steps: Array<
    | { type: 'text'; content: string }
    | { type: 'code'; content: string; copyText?: string }
  >
}

function GuideSection({ guide }: { guide: SetupGuide }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = guide.icon

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-colors',
        expanded && 'bg-muted/20'
      )}
    >
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          className="flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 min-w-0"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{guide.name}</span>
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-[10px] font-normal"
              >
                {guide.platform}
              </Badge>
              <Badge
                variant="outline"
                className="hidden px-1.5 py-0 text-[10px] font-normal sm:inline-flex"
              >
                {guide.transport}
              </Badge>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {guide.description}
            </span>
          </span>
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {/* Visible at rest: the whole point of the row is this snippet. */}
        <CopyButton
          text={guide.quickCopy}
          label="Copy config"
          className="h-7 shrink-0 px-2 text-xs"
        />
      </div>

      {expanded && (
        <div className="space-y-3 border-t p-4">
          {guide.steps.map((step, i) =>
            step.type === 'text' ? (
              <p key={i} className="text-xs text-muted-foreground">
                {step.content}
              </p>
            ) : (
              <CodeBlock key={i} copyText={step.copyText}>
                {step.content}
              </CodeBlock>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function McpSetupGuides() {
  const [endpointUrl, setEndpointUrl] = useState(
    'https://your-deployment.example.com/api/mcp'
  )

  useEffect(() => {
    setEndpointUrl(`${window.location.origin}/api/mcp`)
  }, [])

  // The snippets each row copies at rest — defined once and reused as both the
  // collapsed-row quick copy and the expanded code block.
  const desktopConfig = JSON.stringify(
    { mcpServers: { 'clickhouse-monitor': { url: endpointUrl } } },
    null,
    2
  )
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        'clickhouse-monitor': { url: endpointUrl, transport: 'http' },
      },
    },
    null,
    2
  )
  const claudeCodeCommand = `claude mcp add --transport http clickhouse-monitor ${endpointUrl}`
  // A complete 2026-07-28 request: there is no initialize handshake, so the
  // protocol version and client capabilities travel in `_meta` on every call.
  const listToolsPayload = JSON.stringify(
    buildJsonRpcRequest('tools/list', {})
  ).replace(/'/g, "'\\''")

  const guides: SetupGuide[] = [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      description:
        'Add to claude_desktop_config.json to connect Claude Desktop',
      icon: MessageSquare,
      platform: 'macOS · Windows',
      transport: 'Streamable HTTP',
      quickCopy: desktopConfig,
      steps: [
        {
          type: 'text',
          content:
            'Open your Claude Desktop config file. On macOS it is at ~/Library/Application Support/Claude/claude_desktop_config.json, on Windows at %APPDATA%/Claude/claude_desktop_config.json.',
        },
        {
          type: 'text',
          content: 'Add the following to your mcpServers section:',
        },
        { type: 'code', content: desktopConfig },
        {
          type: 'text',
          content: 'Restart Claude Desktop to apply the changes.',
        },
      ],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Add via the claude mcp add command in your terminal',
      icon: Terminal,
      platform: 'CLI',
      transport: 'Streamable HTTP',
      quickCopy: claudeCodeCommand,
      steps: [
        {
          type: 'text',
          content:
            'Run the following command in your terminal to add the MCP server to Claude Code:',
        },
        { type: 'code', content: claudeCodeCommand },
        {
          type: 'text',
          content:
            'You can verify the server was added by running: claude mcp list',
        },
        {
          type: 'code',
          content: 'claude mcp list',
          copyText: 'claude mcp list',
        },
      ],
    },
    {
      id: 'cursor',
      name: 'Cursor',
      description: 'Add via Settings > MCP in the Cursor IDE',
      icon: MousePointerClick,
      platform: 'IDE',
      transport: 'Streamable HTTP',
      quickCopy: cursorConfig,
      steps: [
        {
          type: 'text',
          content:
            'Open Cursor Settings (Cmd+, on macOS), navigate to Features > MCP, and click "Add MCP Server".',
        },
        {
          type: 'text',
          content:
            'Alternatively, add the following to your .cursor/mcp.json file:',
        },
        { type: 'code', content: cursorConfig },
      ],
    },
    {
      id: 'other',
      name: 'Other MCP Clients',
      description: 'Any MCP-compatible client using Streamable HTTP transport',
      icon: Plug,
      platform: 'Any',
      transport: 'Streamable HTTP',
      quickCopy: endpointUrl,
      steps: [
        {
          type: 'text',
          content:
            'This server speaks the 2026-07-28 Streamable HTTP transport (stateless), and still answers pre-2026 clients. Point your MCP client to the endpoint URL:',
        },
        {
          type: 'code',
          content: endpointUrl,
          copyText: endpointUrl,
        },
        {
          type: 'text',
          content:
            'You can test connectivity with curl by listing available tools:',
        },
        {
          type: 'code',
          content: `curl -X POST ${endpointUrl} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION}" \\
  -H "Mcp-Method: tools/list" \\
  -d '${listToolsPayload}'`,
          copyText: `curl -X POST ${endpointUrl} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION}" -H "Mcp-Method: tools/list" -d '${listToolsPayload}'`,
        },
      ],
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Setup Guides</CardTitle>
        <CardDescription className="text-xs">
          Connect your AI assistant to this chmonitor instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {guides.map((guide) => (
          <GuideSection key={guide.id} guide={guide} />
        ))}
      </CardContent>
    </Card>
  )
}
