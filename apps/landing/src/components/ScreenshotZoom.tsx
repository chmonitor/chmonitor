import { useState } from 'react'
import { Dialog, DialogContent, DialogImage } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Props = {
  id: string
  src: string
  srcDark?: string
  alt: string
  className?: string
}

const shotClass = 'block w-full h-auto align-top'

export function ScreenshotZoom({ id, src, srcDark, alt, className }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        data-screenshot-zoom={id}
        className={cn(
          'relative block w-full overflow-hidden rounded-2xl bg-zinc-950 leading-none shadow-[0_24px_80px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65)]',
          className
        )}
        onClick={() => setOpen(true)}
        aria-label={`View full size: ${alt}`}
      >
        <img
          src={src}
          data-shot="light"
          alt={alt}
          loading="lazy"
          decoding="async"
          className={shotClass}
        />
        {srcDark ? (
          <img
            src={srcDark}
            data-shot="dark"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={shotClass}
          />
        ) : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-none bg-transparent p-0 shadow-none">
          {srcDark ? (
            <div className="max-h-[85vh] overflow-auto rounded-lg">
              <img
                src={src}
                data-shot="light"
                alt={alt}
                className="block w-full rounded-lg"
              />
              <img
                src={srcDark}
                data-shot="dark"
                alt=""
                aria-hidden
                className="block w-full rounded-lg"
              />
            </div>
          ) : (
            <DialogImage src={src} alt={alt} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
