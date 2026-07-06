import { Expand } from 'lucide-react'

import { useState } from 'react'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Props = {
  id: string
  src: string
  alt: string
  className?: string
  aspectClass?: string
}

export function ScreenshotZoom({
  id,
  src,
  alt,
  className,
  aspectClass = 'aspect-[16/10]',
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        data-screenshot-zoom={id}
        className={cn(
          'group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.35)] transition-transform duration-500 hover:scale-[1.008] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65)]',
          className
        )}
        onClick={() => setOpen(true)}
        aria-label={`Zoom ${alt}`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn('w-full object-cover object-top', aspectClass)}
        />
        <span className="pointer-events-none absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2.5 py-1.5 text-foreground text-xs opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <Expand className="size-3.5" />
          Zoom
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-none bg-transparent p-0 shadow-none">
          <DialogImage src={src} alt={alt} />
        </DialogContent>
      </Dialog>
    </>
  )
}
