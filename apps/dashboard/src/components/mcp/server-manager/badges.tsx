'use client'

import { CheckCircle2Icon, CircleDashedIcon, Loader2Icon } from 'lucide-react'

import type { McpAuthKind, McpTransport } from '@/lib/swr/use-mcp-registry'

import { Badge } from '@/components/ui/badge'
import { useMcpServerStatus } from '@/lib/swr/use-mcp-registry'

export function TransportBadge({ transport }: { transport: McpTransport }) {
  return (
    <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">
      {transport}
    </Badge>
  )
}

/** Live connected/error/unreachable status, re-probed with the stored auth. */
export function LiveStatusBadge({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  const { status } = useMcpServerStatus(id, enabled)

  if (!enabled) return null

  if (status === 'connecting') {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-[10.5px]">
        <Loader2Icon className="size-3 animate-spin" />
        Checking…
      </span>
    )
  }

  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2Icon className="size-3" />
        Connected
      </span>
    )
  }

  return (
    <span className="text-destructive flex items-center gap-1 text-[10.5px]">
      <CircleDashedIcon className="size-3" />
      Unreachable
    </span>
  )
}

export function AuthBadge({
  authKind,
  headerName,
}: {
  authKind: McpAuthKind
  headerName: string | null
}) {
  if (authKind === 'none') {
    return <span className="text-muted-foreground text-[11px]">No auth</span>
  }
  return (
    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
      {authKind === 'bearer' ? 'Bearer' : `Header: ${headerName ?? '—'}`}
    </Badge>
  )
}
