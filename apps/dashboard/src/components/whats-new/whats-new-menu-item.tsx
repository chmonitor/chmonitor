import { Newspaper } from 'lucide-react'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useWhatsNew } from '@/components/whats-new/whats-new-provider'

export function WhatsNewMenuItem() {
  const { open } = useWhatsNew()
  return (
    <DropdownMenuItem
      className="flex items-center gap-2"
      onClick={() => open()}
      data-testid="nav-user-whats-new"
    >
      <Newspaper className="size-4" />
      <span>What's new</span>
    </DropdownMenuItem>
  )
}
