import { MoreHorizontal } from 'lucide-react'
import type { Row, RowData } from '@tanstack/react-table'

import type { Action } from './types'

import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Lazy import moved outside component to prevent re-import on every render
const ActionItem = lazy(() =>
  import('./action-item').then((res) => ({ default: res.ActionItem }))
)

// NoSsr wrapper for client-only components
function NoSsr({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  if (!mounted) return null
  return <>{children}</>
}

export interface ActionMenuProps<TData extends RowData, TValue> {
  row: Row<TData>
  value: TValue
  actions: Action[]
}

function ActionMenuComponent<TData extends RowData, TValue>({
  row,
  value,
  actions,
}: ActionMenuProps<TData, TValue>) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="size-10 sm:size-8 p-0"
            aria-label="Open menu"
          />
        }
      >
        <span className="sr-only">Open menu</span>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <NoSsr>
          <Suspense fallback={null}>
            {actions?.map((action) => (
              <ActionItem
                key={action}
                value={value}
                row={row as Row<RowData>}
                action={action}
              />
            ))}
          </Suspense>
        </NoSsr>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Memoized export to prevent unnecessary re-renders
export const ActionMenu = ActionMenuComponent as typeof ActionMenuComponent
