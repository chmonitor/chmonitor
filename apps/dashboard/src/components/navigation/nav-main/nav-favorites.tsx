import { GripVertical } from 'lucide-react'

import type { DragEndEvent } from '@dnd-kit/core'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { MenuItem } from './menu-item'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback } from 'react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar'
import { useFavoriteHrefs, useReorderFavorites } from '@/hooks/use-favorites'
import { getFavoriteMenuItems } from '@/lib/menu/derive-favorites'
import { cn } from '@/lib/utils'

interface NavFavoritesProps {
  /** Full menu tree (all sections) — favorites are resolved by href across
   * every section, including nested sub-items. */
  items: MenuItemType[]
  pathname: string
}

/**
 * Hover-only drag handle. Listeners stay on this button so the title
 * remains a real link (`cursor-pointer`) and a click still navigates.
 */
function FavoriteDragHandle({
  listeners,
  attributes,
  hasBadge,
}: Pick<ReturnType<typeof useSortable>, 'listeners' | 'attributes'> & {
  /** The pin sits at `right-7` instead of `right-2` when the item has a
   * badge slot, so the grip has to step one slot further left to match. */
  hasBadge: boolean
}) {
  return (
    <button
      type="button"
      aria-label="Reorder favorite"
      className={cn(
        'absolute top-1/2 right-7 z-10 flex size-5 -translate-y-1/2 cursor-grab items-center justify-center rounded-md text-sidebar-foreground opacity-0 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 group-data-[collapsible=icon]:hidden',
        hasBadge && 'right-12'
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

function SortableFavoriteItem({
  item,
  pathname,
  dragEnabled,
}: {
  item: MenuItemType
  pathname: string
  dragEnabled: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href, disabled: !dragEnabled })

  return (
    <MenuItem
      item={item}
      pathname={pathname}
      liProps={{
        ref: setNodeRef,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
        },
        className: cn(isDragging && 'z-10 opacity-60'),
      }}
      leadingAction={
        dragEnabled ? (
          <FavoriteDragHandle
            listeners={listeners}
            attributes={attributes}
            hasBadge={Boolean(item.isNew || item.countKey)}
          />
        ) : undefined
      }
    />
  )
}

/**
 * "Favorites" group — pinned menu items in pin order, rendered above the
 * regular Main/Others sections. Hidden entirely when there are no favorites
 * (issue #2769). Favorites are derived from the live menu tree by href, so a
 * pinned route that got renamed or removed is dropped silently instead of
 * rendering a broken link.
 *
 * Pins and the reorder grip are hover-only. Drag the grip to reorder; the
 * title stays a link. Collapsed icon-only mode is click-only.
 */
export function NavFavorites({ items, pathname }: NavFavoritesProps) {
  const favoriteHrefs = useFavoriteHrefs()
  const favoriteItems = getFavoriteMenuItems(items, favoriteHrefs)
  const reorderFavorites = useReorderFavorites()
  const { isMobile, state } = useSidebar()
  const dragEnabled = isMobile || state !== 'collapsed'

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (over && active.id !== over.id) {
        reorderFavorites(String(active.id), String(over.id))
      }
    },
    [reorderFavorites]
  )

  if (favoriteItems.length === 0) {
    return null
  }

  const itemIds = favoriteItems.map((item) => item.href)

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">
        Favorites
      </SidebarGroupLabel>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={dragEnabled ? [restrictToVerticalAxis] : undefined}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <SidebarMenu>
            {favoriteItems.map((item) => (
              <SortableFavoriteItem
                key={item.href}
                item={item}
                pathname={pathname}
                dragEnabled={dragEnabled}
              />
            ))}
          </SidebarMenu>
        </SortableContext>
      </DndContext>
    </SidebarGroup>
  )
}
