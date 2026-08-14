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
import { useCallback, useRef } from 'react'
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

interface SortableFavoriteItemProps {
  item: MenuItemType
  pathname: string
  dragEnabled: boolean
  suppressClickRef: { current: boolean }
}

function SortableFavoriteItem({
  item,
  pathname,
  dragEnabled,
  suppressClickRef,
}: SortableFavoriteItemProps) {
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
        className: cn(
          dragEnabled &&
            (isDragging
              ? 'cursor-grabbing [&_a]:cursor-grabbing'
              : 'cursor-grab [&_a]:cursor-grab'),
          isDragging && 'z-10 opacity-60'
        ),
        ...(dragEnabled ? attributes : undefined),
        ...(dragEnabled ? listeners : undefined),
        onClickCapture: (event) => {
          if (!suppressClickRef.current) return
          event.preventDefault()
          event.stopPropagation()
          suppressClickRef.current = false
        },
      }}
    />
  )
}

/**
 * "Favorites" group — pinned menu items in pin order, rendered above the
 * regular Main/Others sections. Hidden entirely when there are no favorites
 * (issue #2769). Favorites are derived from the live menu tree by href, so a
 * pinned route that got renamed or removed is dropped silently instead of
 * rendering a broken link. Expanded (and mobile) rows can be drag-reordered;
 * collapsed icon-only mode stays click-only.
 */
export function NavFavorites({ items, pathname }: NavFavoritesProps) {
  const favoriteHrefs = useFavoriteHrefs()
  const favoriteItems = getFavoriteMenuItems(items, favoriteHrefs)
  const reorderFavorites = useReorderFavorites()
  const { isMobile, state } = useSidebar()
  const dragEnabled = isMobile || state !== 'collapsed'
  const suppressClickRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // A real drag (past the 8px activation) must not navigate. Swallow the
      // click that follows pointerup; drop the flag if none arrives.
      suppressClickRef.current = true
      const { active, over } = event
      if (over && active.id !== over.id) {
        reorderFavorites(String(active.id), String(over.id))
      }
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
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
                suppressClickRef={suppressClickRef}
              />
            ))}
          </SidebarMenu>
        </SortableContext>
      </DndContext>
    </SidebarGroup>
  )
}
