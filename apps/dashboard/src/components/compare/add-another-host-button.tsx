'use client'

import { PlusIcon } from 'lucide-react'

import { useState } from 'react'
import { ConnectionManagerDialog } from '@/components/connections'
import { Button } from '@/components/ui/button'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import { cn } from '@/lib/utils'

interface AddAnotherHostButtonProps {
  className?: string
}

/**
 * Opens the existing ConnectionManagerDialog — same local dialogOpen +
 * useBrowserConnections pattern as the host selector.
 */
export function AddAnotherHostButton({ className }: AddAnotherHostButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { connections, addConnection, updateConnection, deleteConnection } =
    useBrowserConnections()

  return (
    <>
      <Button
        type="button"
        data-testid="add-another-host"
        className={cn('min-h-11 gap-1.5 px-3 sm:min-h-8', className)}
        onClick={() => setDialogOpen(true)}
      >
        <PlusIcon className="size-3.5" strokeWidth={1.5} />
        Add another host
      </Button>
      <ConnectionManagerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connections={connections}
        onAdd={addConnection}
        onUpdate={updateConnection}
        onDelete={deleteConnection}
      />
    </>
  )
}
