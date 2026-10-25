import { Pencil, Plug, Plus, Trash2 } from 'lucide-react'

import {
  type BrowserConnection,
  ConnectionForm,
  type ConnectionFormData,
} from './connection-form'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown'

interface ConnectionWithStatus extends BrowserConnection {
  status?: ConnectionStatus
}

interface ConnectionManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: ConnectionWithStatus[]
  onAdd: (data: ConnectionFormData) => void
  onUpdate: (id: string, data: ConnectionFormData) => void
  onDelete: (id: string) => void
}

type View = { type: 'list' } | { type: 'form'; editing?: ConnectionWithStatus }

function statusBadgeProps(status?: ConnectionStatus) {
  switch (status) {
    case 'connected':
      return {
        className:
          'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        label: 'Connected',
      }
    case 'disconnected':
      return {
        className:
          'border-transparent bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
        label: 'Disconnected',
      }
    default:
      return {
        className: 'border-transparent bg-muted text-muted-foreground',
        label: 'Unknown',
      }
  }
}

export function ConnectionManagerDialog({
  open,
  onOpenChange,
  connections,
  onAdd,
  onUpdate,
  onDelete,
}: ConnectionManagerDialogProps) {
  const [view, setView] = useState<View>({ type: 'list' })
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const handleClose = () => {
    setView({ type: 'list' })
    setConfirmDeleteId(null)
    onOpenChange(false)
  }

  const handleSave = (data: ConnectionFormData) => {
    if (view.type === 'form' && view.editing) {
      onUpdate(view.editing.id, data)
    } else {
      onAdd(data)
    }
    setView({ type: 'list' })
  }

  const handleDeleteConfirm = (id: string) => {
    onDelete(id)
    setConfirmDeleteId(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {view.type === 'list'
              ? 'Connections'
              : view.type === 'form' && view.editing
                ? 'Edit Connection'
                : 'Add Connection'}
          </DialogTitle>
        </DialogHeader>

        {view.type === 'list' ? (
          <div className="space-y-3">
            {connections.length === 0 ? (
              <EmptyState
                compact
                icon={<Plug className="size-6 opacity-60" />}
                title="No connections yet"
                action={{
                  label: 'Add connection',
                  icon: <Plus className="size-4" />,
                  onClick: () => setView({ type: 'form' }),
                }}
              />
            ) : (
              <ul className="space-y-2">
                {connections.map((conn) => {
                  const badge = statusBadgeProps(conn.status)
                  const isConfirming = confirmDeleteId === conn.id
                  return (
                    <li
                      key={conn.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {conn.name}
                          </span>
                          {conn.status && (
                            <Badge
                              className={cn(
                                'text-[10px] max-sm:text-xs px-1.5 py-0',
                                badge.className
                              )}
                            >
                              {badge.label}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground mt-0.5">
                          {conn.host}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <span className="text-xs text-destructive mr-1">
                              Delete?
                            </span>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleDeleteConfirm(conn.id)}
                            >
                              Yes
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              No
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label="Edit connection"
                              onClick={() =>
                                setView({ type: 'form', editing: conn })
                              }
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive hover:text-destructive"
                              aria-label="Delete connection"
                              onClick={() => setConfirmDeleteId(conn.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={() => setView({ type: 'form' })}>
                <Plus className="size-4 mr-1.5" />
                Add Connection
              </Button>
            </div>
          </div>
        ) : (
          <ConnectionForm
            initialValues={
              view.editing
                ? {
                    name: view.editing.name,
                    host: view.editing.host,
                    user: view.editing.user,
                    password: view.editing.password,
                  }
                : undefined
            }
            onSave={handleSave}
            onCancel={() => setView({ type: 'list' })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
