'use client'

/**
 * MCP Server Manager — per-user registry of external Model Context Protocol
 * servers (plan 43). Backed by D1 through `/api/v1/mcp/servers`; each server is
 * validated (SSRF-guarded) on save and loaded alongside the agent's built-in
 * tools at conversation start. Each row also shows a LIVE connection status
 * (re-probed with the server's stored, decrypted auth via
 * `POST /api/v1/mcp/servers/$id/probe`), not just the last manual "Test
 * connection" timestamp — see `LiveStatusBadge`.
 *
 * Distinct from the welcome-screen `AgentMcpPanel` (localStorage quick-config):
 * this surface PERSISTS per-user, server-side, with auth + a template library.
 */

import { PlusIcon, ServerIcon } from 'lucide-react'

import { AddServerForm } from './add-server-form'
import { ServerRow } from './server-row'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useMcpRegistryServers } from '@/lib/swr/use-mcp-registry'
import { cn } from '@/lib/utils'

export function McpServerManager() {
  const { servers, isLoading, error, notEnabled } = useMcpRegistryServers()
  const [showAdd, setShowAdd] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )
  }

  if (notEnabled) {
    return (
      <EmptyState
        variant="no-data"
        icon={<ServerIcon className="size-6" strokeWidth={1.5} />}
        title="MCP registry not enabled"
        description="Registering external MCP servers per user requires the hosted (cloud) deployment with a signed-in account. On self-hosted, add custom servers from the agent's MCP panel instead."
      />
    )
  }

  if (error) {
    return (
      <EmptyState
        variant="error"
        title="Couldn’t load your MCP servers"
        description={error.message}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-[13px]">
          {servers.length === 0
            ? 'No servers registered yet.'
            : `${servers.length} server${servers.length === 1 ? '' : 's'} · loaded with the agent’s built-in tools`}
        </p>
        {!showAdd && (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowAdd(true)}
          >
            <PlusIcon className="size-3.5" />
            Add server
          </Button>
        )}
      </div>

      {showAdd && <AddServerForm onClose={() => setShowAdd(false)} />}

      {servers.length > 0 && (
        <Card
          className={cn('overflow-hidden rounded-xl border bg-card shadow-sm')}
        >
          <div className="divide-border divide-y">
            {servers.map((server) => (
              <ServerRow key={server.id} server={server} />
            ))}
          </div>
        </Card>
      )}

      {servers.length === 0 && !showAdd && (
        <EmptyState
          variant="no-data"
          icon={<ServerIcon className="size-6" strokeWidth={1.5} />}
          title="Register your first MCP server"
          description="Connect an external Model Context Protocol server (Slack, GitHub, Datadog, or any HTTP/SSE endpoint). Its tools become available to the agent."
          action={{
            label: 'Add server',
            onClick: () => setShowAdd(true),
          }}
        />
      )}
    </div>
  )
}
