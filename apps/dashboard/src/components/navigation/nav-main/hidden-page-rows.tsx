import { ArrowUpRight, Pin, Plus } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { useIsFavorite, useToggleFavorite } from '@/hooks/use-favorites'
import { cn } from '@/lib/utils'

export interface HiddenPageRow {
  href: string
  title: string
  description?: string
  icon?: MenuItem['icon']
}

/**
 * Hidden-page rows for hover-Add (primary click adds) and More (primary
 * click navigates; hover Add / Pin).
 */
export function HiddenPageRows({
  items,
  mode,
  onAdd,
  onNavigate,
}: {
  items: readonly HiddenPageRow[]
  mode: 'add' | 'navigate'
  onAdd: (href: string) => void
  onNavigate?: () => void
}) {
  if (items.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        No hidden pages in this group.
      </p>
    )
  }

  return (
    <ul className="flex min-w-0 flex-col">
      {items.map((item) =>
        mode === 'add' ? (
          <AddRow key={item.href} item={item} onAdd={onAdd} />
        ) : (
          <NavigateRow
            key={item.href}
            item={item}
            onAdd={onAdd}
            onNavigate={onNavigate}
          />
        )
      )}
    </ul>
  )
}

function AddRow({
  item,
  onAdd,
}: {
  item: HiddenPageRow
  onAdd: (href: string) => void
}) {
  const Icon = item.icon
  return (
    <li className="flex min-w-0 items-center gap-0.5">
      <button
        type="button"
        data-testid="hidden-page-add"
        data-href={item.href}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-muted lg:min-h-8"
        onClick={() => onAdd(item.href)}
      >
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 truncate">{item.title}</span>
      </button>
      <HostPrefixedLink
        href={item.href}
        aria-label={`Open ${item.title}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:size-8"
      >
        <ArrowUpRight className="size-3.5" />
      </HostPrefixedLink>
    </li>
  )
}

function NavigateRow({
  item,
  onAdd,
  onNavigate,
}: {
  item: HiddenPageRow
  onAdd: (href: string) => void
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const isPinned = useIsFavorite(item.href)
  const toggleFavorite = useToggleFavorite()

  return (
    <li className="group/hidden-row flex min-w-0 items-center gap-0.5">
      <HostPrefixedLink
        href={item.href}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-muted lg:min-h-8"
        onClick={onNavigate}
      >
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 truncate">{item.title}</span>
      </HostPrefixedLink>
      <button
        type="button"
        data-testid="hidden-page-add"
        data-href={item.href}
        aria-label={`Add ${item.title} to sidebar`}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover/hidden-row:opacity-100 group-focus-within/hidden-row:opacity-100 lg:size-8'
        )}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onAdd(item.href)
        }}
      >
        <Plus className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={isPinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
        aria-pressed={isPinned}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover/hidden-row:opacity-100 group-focus-within/hidden-row:opacity-100 lg:size-8"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toggleFavorite(item.href)
        }}
      >
        <Pin className={cn('size-3.5', isPinned && 'fill-current')} />
      </button>
    </li>
  )
}
