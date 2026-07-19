import { Pin } from 'lucide-react'

import { SidebarMenuAction } from '@/components/ui/sidebar'
import { useIsFavorite, useToggleFavorite } from '@/hooks/use-favorites'
import { cn } from '@/lib/utils'

interface PinButtonProps {
  href: string
  title: string
  /**
   * Shift the action left of the `isNew`/count badge slot when one is
   * present — both live in the same absolute right-1 corner (see
   * `SidebarMenuBadge`).
   */
  hasBadge?: boolean
}

/**
 * Hover-revealed pin/unpin affordance for a top-level sidebar menu item
 * (issue #2769) — same reveal pattern as `CardToolbar`. Renders as a sibling
 * of `SidebarMenuButton` via `SidebarMenuAction` rather than nesting inside
 * the link, so clicking it never triggers navigation.
 */
export function PinButton({ href, title, hasBadge }: PinButtonProps) {
  const isPinned = useIsFavorite(href)
  const toggleFavorite = useToggleFavorite()

  return (
    <SidebarMenuAction
      showOnHover={!isPinned}
      className={cn(
        // `SidebarMenuAction` forces `[&>svg]:size-4`; override so the pin
        // stays small and inset from the very right edge with breathing room.
        'right-2 [&>svg]:size-3',
        hasBadge && 'right-7',
        isPinned && 'opacity-100'
      )}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFavorite(href)
      }}
      aria-label={isPinned ? `Unpin ${title}` : `Pin ${title}`}
      aria-pressed={isPinned}
    >
      <Pin className={cn(isPinned && 'fill-current')} />
    </SidebarMenuAction>
  )
}

interface SubPinButtonProps {
  href: string
  title: string
  hasBadge?: boolean
}

/**
 * Hover-revealed pin/unpin affordance for a sidebar sub-item.
 * `SidebarMenuSubButton` has no `peer/menu-button` sizing hooks like the
 * top-level button, so this is a standalone absolutely-positioned sibling
 * tied to the existing `group/menu-sub-item` hover group instead of reusing
 * `SidebarMenuAction`.
 */
export function SubPinButton({ href, title, hasBadge }: SubPinButtonProps) {
  const isPinned = useIsFavorite(href)
  const toggleFavorite = useToggleFavorite()

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFavorite(href)
      }}
      aria-label={isPinned ? `Unpin ${title}` : `Pin ${title}`}
      aria-pressed={isPinned}
      className={cn(
        'absolute top-1/2 right-2 flex aspect-square size-5 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground opacity-0 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-data-[collapsible=icon]:hidden',
        hasBadge && 'right-7',
        isPinned && 'opacity-100'
      )}
    >
      <Pin className={cn('size-3', isPinned && 'fill-current')} />
    </button>
  )
}
