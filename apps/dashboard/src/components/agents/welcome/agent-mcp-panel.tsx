'use client'

/**
 * MCP Config Panel
 *
 * Shows the status of Model Context Protocol servers connected to the agent:
 *   - Built-in clickhouse-monitor server (always present). Its tool count,
 *     resource count, version, and connection status are derived live from
 *     /api/v1/mcp/info. The built-in server is always on and its toggle is
 *     read-only — it cannot be disabled.
 *   - User-added custom servers. These persist to localStorage via
 *     {@link useMcpConfig} (mirroring how individual MCP tool selections are
 *     stored by `useToolConfig`); they can be toggled, added, and removed.
 *
 * Follows the assistant-ui MCP config pattern:
 *   https://www.assistant-ui.com/docs/ui/mcp-config
 *
 * Note: custom servers are not yet wired to the agent runtime, so their
 * persisted enable/disable state is a stored user preference rather than a
 * live runtime binding.
 */

import { PlusIcon, Trash2Icon, WrenchIcon } from 'lucide-react'

import type { McpServer } from './mcp-types'

import {
  AddMcpServerDialog,
  type AddServerInput,
} from './add-mcp-server-dialog'
import { McpToolsResourcesDialog } from './mcp-tools-resources-dialog'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toMcpServers, useMcpConfig } from '@/lib/hooks/use-mcp-config'
import { useMcpProbe } from '@/lib/swr/use-mcp-probe'
import { useMcpServerInfo } from '@/lib/swr/use-mcp-server-info'

// Re-exported for existing consumers; canonical definition lives in mcp-types.ts.
export type { McpServer }

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: McpServer['status'] }) {
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    )
  }
  if (status === 'connecting') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
        Connecting
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        Error
      </span>
    )
  }
  return <span className="text-muted-foreground text-[10px]">Unconfigured</span>
}

// ---------------------------------------------------------------------------
// Single server row
// ---------------------------------------------------------------------------

interface McpServerRowProps {
  server: McpServer
  onToggle: (id: string, next: boolean) => void
  onViewDetails: (server: McpServer) => void
  onRemove?: (id: string) => void
}

function McpServerRow({
  server,
  onToggle,
  onViewDetails,
  onRemove,
}: McpServerRowProps) {
  return (
    <div className="flex items-center gap-2 py-2 pr-3 pl-2">
      {/* Icon */}
      <div className="bg-muted inline-flex size-7 shrink-0 items-center justify-center rounded-md">
        <WrenchIcon className="text-foreground size-3.5" />
      </div>

      {/* Info — clickable region; stopPropagation not needed since Toggle is a sibling */}
      <button
        type="button"
        className="hover:bg-muted/40 -mx-1 min-w-0 flex-1 cursor-pointer rounded px-1 py-0.5 text-left transition-colors"
        onClick={() => onViewDetails(server)}
        aria-label={`View tools and resources for ${server.name}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[12.5px]">
            {server.name}
          </span>
          {server.version && (
            <Badge
              variant="outline"
              className="h-4 shrink-0 px-1.5 text-[10px]"
            >
              {server.version}
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10.5px] tabular-nums">
          <span>{server.toolCount} tools</span>
          {server.resourceCount !== undefined && (
            <>
              <span className="text-border">·</span>
              <span>{server.resourceCount} resources</span>
            </>
          )}
          <span className="text-border">·</span>
          <StatusBadge status={server.status} />
        </div>
      </button>

      {/* Remove — only for user-added custom servers */}
      {!server.builtin && onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive size-7 shrink-0"
          onClick={() => onRemove(server.id)}
          aria-label={`Remove ${server.name}`}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      )}

      {/* Toggle — disabled for built-in servers (always on, cannot be disabled) */}
      <Switch
        checked={server.enabled}
        disabled={server.builtin}
        onCheckedChange={(next) => onToggle(server.id, next)}
        className="shrink-0"
        aria-label={
          server.builtin
            ? `${server.name} is always enabled`
            : `Toggle ${server.name}`
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom server row — probes the endpoint to get live status + tool list
// ---------------------------------------------------------------------------

interface CustomMcpServerRowProps {
  server: McpServer
  onToggle: (id: string, next: boolean) => void
  onViewDetails: (server: McpServer) => void
  onRemove: (id: string) => void
}

function CustomMcpServerRow({
  server,
  onToggle,
  onViewDetails,
  onRemove,
}: CustomMcpServerRowProps) {
  const probe = useMcpProbe({
    endpoint: server.endpoint,
    name: server.name,
    enabled: server.enabled,
  })

  // Merge live probe results into the server shape for the row + dialog.
  const liveServer: McpServer = {
    ...server,
    status: server.enabled ? probe.status : 'unconfigured',
    toolCount: server.enabled ? probe.toolCount : 0,
    probeTools: server.enabled ? probe.tools : undefined,
  }

  return (
    <McpServerRow
      server={liveServer}
      onToggle={onToggle}
      onViewDetails={onViewDetails}
      onRemove={onRemove}
    />
  )
}

// ---------------------------------------------------------------------------
// Panel root
// ---------------------------------------------------------------------------

export function AgentMcpPanel() {
  const { data, isLoading, error } = useMcpServerInfo()
  const {
    customServers,
    isServerEnabled,
    setServerEnabled,
    addServer,
    removeServer,
  } = useMcpConfig()
  const [addServerOpen, setAddServerOpen] = useState(false)
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null)

  // Derive real connection status for the built-in server from the
  // /api/v1/mcp/info fetch state.
  const builtinStatus: McpServer['status'] = isLoading
    ? 'connecting'
    : error
      ? 'error'
      : 'connected'

  // Built-in server (live data, always on) first, then user-added custom
  // servers restored from localStorage.
  const servers: McpServer[] = [
    {
      id: 'clickhouse-monitor',
      name: data?.name ?? 'clickhouse-monitor',
      endpoint: '/api/mcp',
      toolCount: data?.tools.length ?? 0,
      resourceCount: data?.resources.length,
      version: data?.version,
      builtin: true,
      enabled: true,
      status: builtinStatus,
    },
    ...toMcpServers(customServers, isServerEnabled),
  ]

  const handleToggle = (id: string, next: boolean) => {
    setServerEnabled(id, next)
  }

  const handleAddServer = (server: AddServerInput) => {
    // The dialog closes itself on submit; the panel only needs to persist.
    addServer(server)
  }

  const panelStatus =
    builtinStatus === 'connected' ? 'configured' : 'unconfigured'
  const activeCount = servers.filter((s) => s.enabled).length

  return (
    <div className="flex flex-col gap-2">
      {/* Tools/resources detail dialog */}
      <McpToolsResourcesDialog
        server={selectedServer}
        open={selectedServer !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedServer(null)
        }}
      />

      {/* Summary row */}
      <div className="text-muted-foreground flex items-center justify-between text-[10.5px]">
        <span>
          <span className="text-foreground font-medium">{activeCount}</span>/
          {servers.length} active
        </span>
        {panelStatus === 'configured' ? (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Configured
          </span>
        ) : (
          <span className="text-muted-foreground flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
            {isLoading ? 'Connecting…' : 'Unconfigured'}
          </span>
        )}
      </div>

      {/* Server list */}
      <div className="border-border divide-border divide-y rounded-md border">
        {servers.map((server) =>
          server.builtin ? (
            <McpServerRow
              key={server.id}
              server={server}
              onToggle={handleToggle}
              onViewDetails={setSelectedServer}
            />
          ) : (
            <CustomMcpServerRow
              key={server.id}
              server={server}
              onToggle={handleToggle}
              onViewDetails={setSelectedServer}
              onRemove={removeServer}
            />
          )
        )}
      </div>

      {/* Connect new server — opens a registration dialog */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1 h-8 w-full justify-center gap-1.5 text-[11.5px]"
        onClick={() => setAddServerOpen(true)}
      >
        <PlusIcon className="size-3" />
        Connect new server
      </Button>

      <AddMcpServerDialog
        open={addServerOpen}
        onOpenChange={setAddServerOpen}
        onAdd={handleAddServer}
      />
    </div>
  )
}
