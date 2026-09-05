'use client'

import { Loader2Icon, ServerIcon, Trash2Icon } from 'lucide-react'

import type { McpRegistrationDto } from '@/lib/swr/use-mcp-registry'

import { AuthBadge, LiveStatusBadge, TransportBadge } from './badges'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  useDeleteMcpServer,
  usePatchMcpServer,
} from '@/lib/swr/use-mcp-registry'

export function ServerRow({ server }: { server: McpRegistrationDto }) {
  const patch = usePatchMcpServer()
  const remove = useDeleteMcpServer()

  const toolCount = server.capabilities?.length ?? 0
  const validated = server.lastValidatedAt
    ? new Date(server.lastValidatedAt).toLocaleDateString()
    : null

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md">
        <ServerIcon className="text-foreground size-4" strokeWidth={1.5} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {server.name}
          </span>
          <TransportBadge transport={server.transport} />
          <AuthBadge
            authKind={server.authKind}
            headerName={server.authHeaderName}
          />
          <LiveStatusBadge id={server.id} enabled={server.enabled} />
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px]">
          <span className="truncate">{server.url}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10.5px] tabular-nums">
          <span>{toolCount} tools</span>
          {validated && (
            <>
              <span className="text-border">·</span>
              <span>validated {validated}</span>
            </>
          )}
          {!server.enabled && (
            <>
              <span className="text-border">·</span>
              <span>disabled</span>
            </>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive size-8 shrink-0"
        disabled={remove.isPending}
        onClick={() => remove.mutate(server.id)}
        aria-label={`Remove ${server.name}`}
      >
        {remove.isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
      </Button>

      <Switch
        checked={server.enabled}
        disabled={patch.isPending}
        onCheckedChange={(next) =>
          patch.mutate({ id: server.id, enabled: next })
        }
        aria-label={
          server.enabled ? `Disable ${server.name}` : `Enable ${server.name}`
        }
        className="shrink-0"
      />
    </div>
  )
}
