'use client'

/**
 * MCP servers tab — `/agents/settings`.
 *
 * Splits what used to be one flat "MCP servers" list into two clearly
 * distinct sections, since they're very different things:
 *
 * - **Built-in**: this dashboard's own read-only MCP endpoint, self-access to
 *   the CURRENT cluster. Always on, nothing to add/configure — shown as a
 *   fixed card with a link to the full setup guide (`/mcp`).
 * - **External**: servers the user registers themselves (Firecrawl, GitHub,
 *   Slack, a custom endpoint, …) so their tools load into the agent. Backed
 *   by `McpServerManager` (D1-persisted, per-user, with bearer/header auth
 *   and a live connection-status probe per row).
 */

import { ArrowUpRightIcon, UnplugIcon } from 'lucide-react'

import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { McpEndpointUrl } from '@/components/mcp/mcp-endpoint-url'
import { McpServerManager } from '@/components/mcp/mcp-server-manager'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMcpServerInfo } from '@/lib/swr/use-mcp-server-info'

function BuiltInMcpServerCard() {
  const { data, isLoading } = useMcpServerInfo()

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="bg-muted inline-flex size-9 shrink-0 items-center justify-center rounded-md">
            <ChmonitorLogo width={18} height={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium">
                chmonitor MCP server
              </span>
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[10px] font-normal"
              >
                Built-in
              </Badge>
            </div>
            <p className="text-muted-foreground mt-0.5 text-[11.5px] leading-snug">
              Read-only self-access to THIS cluster — always available to the
              agent, nothing to register.
              {isLoading ? (
                <Skeleton className="mt-1 h-3 w-24" />
              ) : (
                data && ` ${data.tools.length} tools advertised.`
              )}
            </p>
          </div>
          <HostPrefixedLink
            href="/mcp"
            className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-[11.5px] font-medium"
          >
            Setup guide
            <ArrowUpRightIcon className="size-3" />
          </HostPrefixedLink>
        </div>
        <McpEndpointUrl />
      </CardContent>
    </Card>
  )
}

export function McpSettingsTab() {
  return (
    <div className="space-y-5">
      <BuiltInMcpServerCard />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <UnplugIcon className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
            External MCP servers
          </span>
        </div>
        <p className="text-muted-foreground text-[11.5px] leading-snug">
          Servers you register yourself so their tools load into the agent
          alongside the built-in ones — e.g. Firecrawl, GitHub, Slack, or any
          HTTP/SSE MCP endpoint.
        </p>
        <McpServerManager />
      </div>
    </div>
  )
}
