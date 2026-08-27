import { Pin } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'

import { useIsFavorite, useToggleFavorite } from '@/hooks/use-favorites'
import { getBreadcrumbPath } from '@/lib/menu/breadcrumb'
import { pathnameMatchesMenuHref } from '@/lib/menu/hidden-siblings'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { cn } from '@/lib/utils'

/**
 * Shown on a workspace-hidden page (including via ⌘K). Keep adds the href
 * to the sidebar; Pin is the existing favorites toggle. Does not auto-unhide
 * on navigation.
 */
export function KeepInSidebarChip() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const { catalog, hiddenHrefs, showHref } = useMenuWorkspaceCatalog()
  const crumbs = getBreadcrumbPath(pathname, catalog)
  const href = crumbs.find((crumb) => crumb.href)?.href
  if (!href || !hiddenHrefs.has(href)) {
    if (!href) return null
    // Fallback: pathname itself may be hidden even when breadcrumb used a parent.
    const hiddenHref = [...hiddenHrefs].find((item) =>
      pathnameMatchesMenuHref(pathname, item)
    )
    if (!hiddenHref) return null
    return <KeepChip href={hiddenHref} onKeep={showHref} />
  }
  return <KeepChip href={href} onKeep={showHref} />
}

function KeepChip({
  href,
  onKeep,
}: {
  href: string
  onKeep: (href: string) => void
}) {
  const isPinned = useIsFavorite(href)
  const toggleFavorite = useToggleFavorite()

  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        data-testid="keep-in-sidebar"
        onClick={() => onKeep(href)}
        className={cn(
          'inline-flex h-8 min-h-8 items-center rounded-md border border-border px-2 text-[13px] font-medium hover:bg-muted'
        )}
      >
        Keep in sidebar
      </button>
      <button
        type="button"
        data-testid="keep-in-sidebar-pin"
        aria-label={isPinned ? 'Unpin page' : 'Pin page'}
        aria-pressed={isPinned}
        onClick={() => toggleFavorite(href)}
        className="inline-flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted"
      >
        <Pin className={cn('size-3.5', isPinned && 'fill-current')} />
      </button>
    </span>
  )
}
