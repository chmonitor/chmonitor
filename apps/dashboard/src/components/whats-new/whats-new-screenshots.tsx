import { XIcon } from 'lucide-react'

import type { ReleaseNoteScreenshot } from '@/lib/whats-new/types'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function WhatsNewScreenshotGallery({
  shots,
  onOpen,
}: {
  shots: readonly ReleaseNoteScreenshot[]
  onOpen: (shot: ReleaseNoteScreenshot) => void
}) {
  if (shots.length === 0) return null

  return (
    <div
      className={cn(
        'scrollbar-hide mt-1 flex gap-2 overflow-x-auto py-1',
        shots.length === 1 && 'grid grid-cols-1 overflow-visible'
      )}
      data-testid="whats-new-screenshots"
    >
      {shots.map((shot) => (
        <button
          key={shot.src}
          type="button"
          onClick={() => onOpen(shot)}
          className={cn(
            'group relative overflow-hidden rounded-md border border-border bg-muted/30 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            shots.length === 1 ? 'w-full max-w-xs' : 'w-40 shrink-0'
          )}
          data-testid="whats-new-screenshot-thumb"
          aria-label={
            shot.alt
              ? `View screenshot: ${shot.alt}`
              : 'View screenshot full size'
          }
        >
          <img
            src={shot.src}
            alt={shot.alt || ''}
            loading="lazy"
            decoding="async"
            className="aspect-[16/10] w-full object-cover object-top transition-opacity group-hover:opacity-90"
          />
        </button>
      ))}
    </div>
  )
}

export function WhatsNewScreenshotLightbox({
  shot,
  onClose,
}: {
  shot: ReleaseNoteScreenshot | null
  onClose: () => void
}) {
  if (!shot) return null

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-background/95"
      data-testid="whats-new-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={shot.alt || 'Screenshot'}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="truncate text-xs text-muted-foreground">
          {shot.alt || 'Screenshot'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close screenshot"
          data-testid="whats-new-lightbox-close"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <button
        type="button"
        className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-3"
        onClick={onClose}
        aria-label="Close screenshot"
      >
        <img
          src={shot.src}
          alt={shot.alt || ''}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      </button>
    </div>
  )
}
