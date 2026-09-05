'use client'

import {
  DatabaseTree,
  type DatabaseTreeProps,
} from '@/components/explorer/tree'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'

export function SchemaSidebar({
  treeProps,
  isOpen,
  onOpenChange,
}: {
  treeProps: DatabaseTreeProps
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const tree = (
    <div
      className="overflow-y-auto px-2 pb-4"
      data-testid="advisor-schema-tree"
    >
      <DatabaseTree {...treeProps} />
    </div>
  )

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Database browser</SheetTitle>
          </SheetHeader>
          <div className="flex h-full flex-col">{tree}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r md:w-72 lg:w-80">
      {tree}
    </div>
  )
}
