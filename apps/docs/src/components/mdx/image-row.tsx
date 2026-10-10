import type { ReactNode } from 'react'

import { ZoomableFrame } from './screenshot'

export interface ImageRowItem {
  src: string
  srcDark?: string
  alt: string
  caption?: ReactNode
}

export interface ImageRowProps {
  images: ImageRowItem[]
  /** Column count on wide screens (2-4). Defaults to the image count, clamped. */
  cols?: 2 | 3 | 4
  className?: string
}

// Literal class strings so Tailwind can see them. 3/4 cols drop to 2 below
// md, and every row stacks to one column on phones (blog: 700px / 520px).
const COLS: Record<2 | 3 | 4, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 md:grid-cols-3',
  4: 'sm:grid-cols-2 md:grid-cols-4',
}

export function clampCols(n: number): 2 | 3 | 4 {
  return Math.min(4, Math.max(2, Math.round(n))) as 2 | 3 | 4
}

export function ImageRow({ images, cols, className = '' }: ImageRowProps) {
  const n = clampCols(cols ?? images.length)
  return (
    <div
      data-cols={n}
      className={`not-prose my-8 grid grid-cols-1 gap-3 ${COLS[n]} ${className}`}
    >
      {images.map((img) => (
        <figure key={img.src} className="m-0 min-w-0">
          <ZoomableFrame
            src={img.src}
            srcDark={img.srcDark}
            alt={img.alt}
            imgClassName="sm:aspect-[16/10] sm:object-cover sm:object-top"
          />
          {img.caption ? (
            <figcaption className="px-0.5 pt-2 text-[13px] leading-snug text-pretty text-fd-muted-foreground">
              {img.caption}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  )
}
