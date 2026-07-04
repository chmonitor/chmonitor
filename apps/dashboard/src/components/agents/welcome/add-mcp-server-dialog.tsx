'use client'

/**
 * AddMcpServerDialog
 *
 * Hosts the "Connect new server" registration form in a shadcn Dialog.
 * Previously this form rendered inline beneath the MCP server list in
 * AgentMcpPanel; it now opens as a dialog so the panel stays compact and the
 * flow matches the other "Connect" entries.
 *
 * The registered server is persisted to localStorage by useMcpConfig (via the
 * caller's onAdd). As noted in AgentMcpPanel, custom servers are a stored user
 * preference and are not yet wired to the agent runtime.
 */

import { PlugZapIcon } from 'lucide-react'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** A custom server the user is about to register. */
export interface AddServerInput {
  name: string
  endpoint: string
}

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (server: AddServerInput) => void
}

export function AddMcpServerDialog({
  open,
  onOpenChange,
  onAdd,
}: AddMcpServerDialogProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  const canSubmit = trimmedName.length > 0 && trimmedUrl.length > 0

  const inputClass = cn(
    'bg-background border-input h-9 w-full rounded-md border px-3 text-[13px]',
    'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
  )

  // Reset the fields whenever the dialog closes so a re-open starts clean.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setUrl('')
    }
    onOpenChange(next)
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    onAdd({ name: trimmedName, endpoint: trimmedUrl })
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PlugZapIcon className="size-4" strokeWidth={1.6} />
            Connect new server
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Register a custom MCP server by name and endpoint URL.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="space-y-1.5">
            <label
              htmlFor="mcp-server-name"
              className="text-muted-foreground text-[11px] font-medium"
            >
              Server name
            </label>
            <input
              id="mcp-server-name"
              type="text"
              placeholder="my-mcp-server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="mcp-server-url"
              className="text-muted-foreground text-[11px] font-medium"
            >
              Endpoint URL
            </label>
            <input
              id="mcp-server-url"
              type="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
