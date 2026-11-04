import { Pin } from 'lucide-react'

import { useIsFavorite, useToggleFavorite } from '@/hooks/use-favorites'
import { cn } from '@/lib/utils'

interface PagePinToggleProps {
  href: string
  title: string
  className?: string
  /** Applied only while unpinned, so a pinned page always shows its marker. */
  unpinnedClassName?: string
}

/**
 * Pin / unpin a page from a list outside the rail (hub cards, group flyout).
 * Render it as a sibling of the page link, never inside it: the click must not
 * navigate or close the surrounding popover.
 */
export function PagePinToggle({
  href,
  title,
  className,
  unpinnedClassName,
}: PagePinToggleProps) {
  const pinned = useIsFavorite(href)
  const toggleFavorite = useToggleFavorite()

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleFavorite(href)
      }}
      aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
      aria-pressed={pinned}
      className={cn(
        'flex items-center justify-center rounded-md text-muted-foreground outline-hidden transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring',
        className,
        pinned ? 'text-foreground' : unpinnedClassName
      )}
    >
      <Pin className={cn('size-3.5', pinned && 'fill-current')} />
    </button>
  )
}
