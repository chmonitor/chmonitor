import {
  CopyIcon,
  EllipsisVerticalIcon,
  RotateCcwIcon,
  SortAscIcon,
  SortDescIcon,
} from 'lucide-react'
import type { Header } from '@tanstack/react-table'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface ColumnHeaderDropdownProps {
  header: Header<any, unknown>
}

export const ColumnHeaderDropdown = function ColumnHeaderDropdown({
  header,
}: ColumnHeaderDropdownProps) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const reopenTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Clear any pending re-open timeout on unmount
  useEffect(() => {
    return () => clearTimeout(reopenTimeoutRef.current)
  }, [])

  const column = header.column
  const canSort = column.getCanSort()

  // Close and re-open dropdown to force re-render with new sort
  const reopenDropdown = () => {
    setOpen(false)
    clearTimeout(reopenTimeoutRef.current)
    reopenTimeoutRef.current = setTimeout(() => setOpen(true), 0)
  }

  const handleSortAsc = (_e: React.MouseEvent) => {
    column.toggleSorting(false)
    reopenDropdown()
  }

  const handleSortDesc = (_e: React.MouseEvent) => {
    column.toggleSorting(true)
    reopenDropdown()
  }

  const handleResetSort = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    column.clearSorting()
    // Keep dropdown open after reset
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(column.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              'size-10 sm:size-7',
              'opacity-0 group-hover:opacity-40 hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
              'transition'
            )}
            aria-label={`Column options for ${column.id}`}
          />
        }
      >
        <EllipsisVerticalIcon data-icon="inline-start" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {canSort && (
          <>
            <DropdownMenuItem onClick={handleSortAsc}>
              <SortAscIcon className="mr-2 size-3.5" />A → Z
              {column.getIsSorted() === 'asc' && (
                <>
                  <span className="ml-auto text-xs" aria-hidden="true">
                    ✓
                  </span>
                  <span className="sr-only">active</span>
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSortDesc}>
              <SortDescIcon className="mr-2 size-3.5" />Z → A
              {column.getIsSorted() === 'desc' && (
                <>
                  <span className="ml-auto text-xs" aria-hidden="true">
                    ✓
                  </span>
                  <span className="sr-only">active</span>
                </>
              )}
            </DropdownMenuItem>
          </>
        )}
        {(canSort || column.getIsSorted()) && (
          <DropdownMenuItem onClick={handleResetSort}>
            <RotateCcwIcon className="mr-2 size-3.5" />
            Reset sort
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleCopy}>
          <CopyIcon className="mr-2 size-3.5" />
          {copied ? 'Copied!' : 'Copy name'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
