import { X, ZoomIn } from 'lucide-react'

import {
  closeZoom,
  openZoom,
  shouldCloseOnClick,
  shouldCloseOnKey,
} from './zoom-controller'
import { type ReactNode, useId, useRef } from 'react'

export interface ScreenshotProps {
  src: string
  srcDark?: string
  alt: string
  caption?: ReactNode
  /** Break out of the text column up to ~1080px. */
  wide?: boolean
  className?: string
}

const WIDE =
  'relative left-1/2 w-[min(1080px,calc(100vw-32px))] max-w-none -translate-x-1/2'

/**
 * Light + dark <img> pair toggled by the `dark` class, so the right image is
 * shown on first paint with no hydration flash.
 */
export function ThemedImage({
  src,
  srcDark,
  alt,
  className = '',
}: {
  src: string
  srcDark?: string
  alt: string
  className?: string
}) {
  const base = `m-0 block h-auto w-full ${className}`
  if (!srcDark) {
    return <img src={src} alt={alt} loading="lazy" className={base} />
  }
  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        data-theme-src="light"
        className={`${base} dark:hidden`}
      />
      <img
        src={srcDark}
        alt=""
        aria-hidden="true"
        loading="lazy"
        data-theme-src="dark"
        className={`${base} hidden dark:block`}
      />
    </>
  )
}

/** Framed, zoomable image. Shared by Screenshot and ImageRow cells. */
export function ZoomableFrame({
  src,
  srcDark,
  alt,
  imgClassName,
}: {
  src: string
  srcDark?: string
  alt: string
  imgClassName?: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = useId()

  // `command`/`commandfor` is the platform's declarative open, so a click that
  // lands before hydration still opens the dialog. onClick covers engines
  // without invoker commands; openZoom is a no-op when already open.
  const open = () => openZoom(dialogRef.current)
  // Lowercase custom attributes: React's DOM props do not know invoker commands.
  const invoker = { command: 'show-modal', commandfor: dialogId }

  return (
    <div className="group relative overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <button
        type="button"
        onClick={open}
        {...invoker}
        aria-label={`Zoom image: ${alt}`}
        className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
      >
        <ThemedImage
          src={src}
          srcDark={srcDark}
          alt={alt}
          className={imgClassName}
        />
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-2.5 inline-flex size-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <ZoomIn className="size-3.5" />
        </span>
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-label={alt}
        onClick={(e) => {
          if (shouldCloseOnClick(e.target, dialogRef.current))
            closeZoom(dialogRef.current)
        }}
        onKeyDown={(e) => {
          if (shouldCloseOnKey(e.key)) closeZoom(dialogRef.current)
        }}
        className="m-auto max-h-[94vh] max-w-[min(96vw,1400px)] border-0 bg-transparent p-0 backdrop:bg-black/70 open:flex open:items-center open:justify-center"
      >
        <button
          type="button"
          onClick={() => closeZoom(dialogRef.current)}
          aria-label="Close"
          className="fixed top-4 right-4 z-10 inline-flex size-10 items-center justify-center rounded-full border border-fd-border bg-fd-card text-fd-foreground"
        >
          <X className="size-5" />
        </button>
        <img
          src={src}
          alt={alt}
          className={`m-auto block max-h-[90vh] w-auto max-w-[min(96vw,1400px)] rounded-lg ${srcDark ? 'dark:hidden' : ''}`}
        />
        {srcDark ? (
          <img
            src={srcDark}
            alt=""
            aria-hidden="true"
            className="m-auto hidden max-h-[90vh] w-auto max-w-[min(96vw,1400px)] rounded-lg dark:block"
          />
        ) : null}
      </dialog>
    </div>
  )
}

export function Screenshot({
  src,
  srcDark,
  alt,
  caption,
  wide = false,
  className = '',
}: ScreenshotProps) {
  return (
    <figure className={`not-prose my-8 ${wide ? WIDE : ''} ${className}`}>
      <ZoomableFrame src={src} srcDark={srcDark} alt={alt} />
      {caption ? (
        <figcaption className="mt-2 px-0.5 text-[13px] leading-snug text-pretty text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
