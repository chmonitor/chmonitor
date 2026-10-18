import { MenuIcon } from 'lucide-react'

import { ExplorerContent } from './explorer-content'
import { ExplorerSidebar } from './explorer-sidebar'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'

export function ExplorerLayout() {
  const isMobile = useIsMobile()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <div
          data-role="explorer-header"
          className="flex items-center gap-3 border-b p-3"
        >
          <Button
            data-role="sidebar-trigger"
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open explorer sidebar"
          >
            <MenuIcon className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold">Data Explorer</h2>
        </div>
        <div className="flex-1 overflow-auto">
          <ExplorerContent />
        </div>
        <ExplorerSidebar
          isOpen={isSidebarOpen}
          onOpenChange={setIsSidebarOpen}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-64 md:w-72 lg:w-80 shrink-0 border-r overflow-auto">
        <ExplorerSidebar />
      </div>
      <div className="flex-1 overflow-auto">
        <ExplorerContent />
      </div>
    </div>
  )
}
