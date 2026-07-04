/**
 * WidgetFrame — shared chrome around every dashboard widget (chart / table /
 * stat / text). Renders a title bar with a drag handle + remove button in
 * arrange mode, and a resize handle in the bottom-right corner. In view mode
 * it renders just the title + content, no edit affordances.
 */

import { GripVertical, X } from 'lucide-react'

import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from '@dnd-kit/core'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface WidgetFrameProps {
  title: string
  mode: 'view' | 'arrange'
  children: ReactNode
  onRemove?: () => void
  /** Forwarded from dnd-kit's `useDraggable` — undefined outside arrange mode. */
  dragHandleRef?: (el: HTMLElement | null) => void
  dragAttributes?: DraggableAttributes
  dragListeners?: DraggableSyntheticListeners
  isDragging?: boolean
  onResizePointerDown?: (e: PointerEvent<HTMLButtonElement>) => void
  onResizePointerMove?: (e: PointerEvent<HTMLButtonElement>) => void
  onResizePointerUp?: (e: PointerEvent<HTMLButtonElement>) => void
  /** Extra style applied to the card during an in-progress resize preview. */
  previewStyle?: CSSProperties
  className?: string
}

export function WidgetFrame({
  title,
  mode,
  children,
  onRemove,
  dragHandleRef,
  dragAttributes,
  dragListeners,
  isDragging,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  previewStyle,
  className,
}: WidgetFrameProps) {
  const arrange = mode === 'arrange'

  return (
    <Card
      className={cn(
        'relative flex h-full min-h-0 flex-col overflow-hidden py-0 gap-0',
        arrange && 'ring-1 ring-border/60',
        isDragging && 'opacity-70 shadow-lg ring-2 ring-primary/50',
        className
      )}
      style={previewStyle}
    >
      <CardHeader
        className={cn(
          'grid-rows-none flex shrink-0 flex-row items-center gap-1.5 border-b px-3 py-2',
          !arrange && 'py-2.5'
        )}
      >
        {arrange && (
          <button
            ref={dragHandleRef}
            type="button"
            className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Drag to move "${title}"`}
            {...dragAttributes}
            {...dragListeners}
          >
            <GripVertical className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
        <CardTitle className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {title}
        </CardTitle>
        {arrange && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove "${title}" widget`}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </button>
        )}
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden p-2">
        {children}
      </CardContent>

      {arrange && onResizePointerDown && (
        <button
          type="button"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          aria-label={`Resize "${title}" widget`}
          className="absolute bottom-0 right-0 flex size-4 cursor-nwse-resize touch-none items-center justify-center text-muted-foreground/60 hover:text-foreground"
        >
          <svg viewBox="0 0 10 10" className="size-2.5" fill="none">
            <path
              d="M9 1 1 9M9 5 5 9M9 9 9 9"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </Card>
  )
}
