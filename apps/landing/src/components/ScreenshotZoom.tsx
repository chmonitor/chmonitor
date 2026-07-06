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
          'relative block w-full overflow-hidden leading-none',
          className
        )}
        onClick={() => setOpen(true)}
        aria-label={`View full size: ${alt}`}
      >
        <img
          src={src}
          {...(srcDark ? { 'data-shot': 'light' as const } : {})}
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
