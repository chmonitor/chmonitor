'use client'

import { PlusIcon } from 'lucide-react'

import { useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AddHostButtonProps {
  className?: string
  label?: string
  variant?: 'default' | 'outline'
}

/**
 * Opens AddHostDialog — same local addOpen pattern as HostSwitcher / first-run.
 */
export function AddHostButton({
  className,
  label = 'Add host',
  variant = 'default',
}: AddHostButtonProps) {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant={variant}
        data-testid="add-host"
        className={cn('min-h-11 gap-1.5 px-3 sm:min-h-8', className)}
        onClick={() => setAddOpen(true)}
      >
        <PlusIcon className="size-3.5" strokeWidth={1.5} />
        {label}
      </Button>
      <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  )
}
