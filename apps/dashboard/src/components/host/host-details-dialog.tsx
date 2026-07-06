import { Info, Loader2, Lock, Pencil } from 'lucide-react'

import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

import { useEffect, useState } from 'react'
import {
  ConnectionForm,
  type ConnectionFormData,
} from '@/components/connections/connection-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import { useUserConnectionsMutations } from '@/lib/hooks/use-user-connections'
import { canEditHost, getHostSourceMeta } from '@/lib/host-permissions'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { isServerHost } from '@/lib/swr/use-merged-hosts'
import { cn } from '@/lib/utils'

interface HostDetailsDialogProps {
  host: MergedHostInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-sm',
          mono && 'font-mono text-[13px]'
        )}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </dd>
    </div>
  )
}

export function HostDetailsDialog({
  host,
  open,
  onOpenChange,
}: HostDetailsDialogProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [saving, setSaving] = useState(false)

  const source = host?.source
  const editable = source ? canEditHost(source) : false
  const meta = source ? getHostSourceMeta(source) : null
  const serverHost = host ? isServerHost(host.source) : false

  // Live status only resolves for server hosts (env/demo). Browser/database
  // hosts have no server-side status entry — skip the poll entirely.
  const { data: status, isLoading: statusLoading } = useHostStatus(
    serverHost ? host!.id : null,
    { refreshInterval: 60000, revalidateOnFocus: false }
  )

  const { updateConnection: updateBrowserConnection, getConnectionByHostId } =
    useBrowserConnections()
  const { updateConnection: updateDbConnection } = useUserConnectionsMutations()

  const browserConn =
    host?.source === 'browser' ? getConnectionByHostId(host.id) : undefined

  // Reset to the view whenever a different host is opened or the dialog closes,
  // so reopening never shows a stale edit form from a previous host.
  useEffect(() => {
    if (open) setMode('view')
  }, [open])

  if (!host || !meta) return null

  const handleSave = async (data: ConnectionFormData) => {
    if (!host || saving) return
    setSaving(true)
    try {
      // Never overwrite a stored password with an empty string. The browser
      // store writes the field directly, so it's omitted when blank; the server
      // PATCH makes the same guard for database connections.
      const updates = {
        name: data.name,
        host: data.host,
        user: data.user,
        ...(data.password ? { password: data.password } : {}),
      }

      if (host.source === 'browser') {
        if (!browserConn) return
        updateBrowserConnection(browserConn.id, updates)
      } else if (host.source === 'database' && host.connectionId) {
        await updateDbConnection(host.connectionId, updates)
      }
      setMode('view')
    } finally {
      setSaving(false)
    }
  }

  const name = host.name || host.host

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {mode === 'view' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 pr-6">
                <span className="truncate">{name}</span>
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px] font-medium"
                >
                  {meta.label}
                </Badge>
              </DialogTitle>
              <DialogDescription className="sr-only">
                Connection details for {name}
              </DialogDescription>
            </DialogHeader>

            <dl className="border-t pt-2">
              <DetailRow label="Name" value={host.name || '—'} />
              <DetailRow label="Host URL" value={host.host} mono />
              <DetailRow label="Username" value={host.user || '—'} mono />
              {serverHost && (
                <DetailRow
                  label="Server"
                  value={
                    statusLoading ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Checking…
                      </span>
                    ) : status ? (
                      <span className="text-muted-foreground">
                        {status.hostname} · v{status.version} · up{' '}
                        {status.uptime}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Unavailable</span>
                    )
                  }
                />
              )}
            </dl>

            <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{meta.note}</span>
            </p>

            <DialogFooter className="flex-row justify-between gap-2">
              {editable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMode('edit')}
                  data-testid="host-details-edit"
                >
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" />
                  Editing disabled
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Edit connection</DialogTitle>
              <DialogDescription>
                Update the credentials for {name}. The host keeps its slot in
                the switcher — your current view won&rsquo;t reset.
              </DialogDescription>
            </DialogHeader>
            <ConnectionForm
              initialValues={{
                name: host.name,
                host: host.host,
                user: host.user,
                // Browser connections have the password locally; prefill it so
                // a no-op save preserves it. Server connections never expose it.
                password: browserConn?.password ?? '',
              }}
              onSave={handleSave}
              onCancel={() => setMode('view')}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
