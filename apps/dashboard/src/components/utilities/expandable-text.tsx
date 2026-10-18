import { ChevronDown } from 'lucide-react'

import type { CSSProperties, ReactNode } from 'react'

import { useEffect, useRef, useState } from 'react'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { cn } from '@/lib/utils'

export interface ExpandableTextProps {
  children: string | ReactNode
  variant?: 'inline' | 'popover'
  maxLines?: number
  showIndicator?: boolean
  className?: string
}

function getLineClampStyle(maxLines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }
}

function checkOverflow(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight
}

function useClickOutside(
  enabled: boolean,
  refs: ReadonlyArray<React.RefObject<HTMLElement | null>>,
  onClose: () => void
) {
  useEffect(() => {
    if (!enabled) return

    const handleClickOutside = (event: MouseEvent) => {
      const isOutside = refs.every(
        (ref) => !ref.current || !ref.current.contains(event.target as Node)
      )
      if (isOutside) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        refs[0].current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [enabled, refs, onClose])
}

const PopoverVariant = function PopoverVariant({
  maxLines,
  showIndicator,
  className,
  isOverflowing,
  textContent,
  contentRef,
  children,
}: {
  maxLines: number
  showIndicator: boolean
  className?: string
  isOverflowing: boolean
  textContent: string
  contentRef: React.RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleToggle = () => {
    setIsOpen((prev) => !prev)
  }

  const handleKeyDown = activateOnEnterOrSpace(handleToggle)

  useClickOutside(isOpen, [contentRef, popoverRef], () => setIsOpen(false))

  return (
    <div className="relative inline-flex items-center gap-1 min-w-0">
      <span
        ref={contentRef}
        className={className}
        style={getLineClampStyle(maxLines)}
        role="button"
        tabIndex={isOverflowing ? 0 : -1}
        aria-expanded={isOpen}
        aria-controls="expandable-popover"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        {children}
      </span>
      {isOverflowing && showIndicator && (
        <button
          type="button"
          onClick={handleToggle}
          onKeyDown={handleKeyDown}
          className="shrink-0 inline-flex items-center justify-center p-0.5 rounded transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
          aria-expanded={isOpen}
          aria-controls="expandable-popover"
          aria-label="Show more"
        >
          <ChevronDown
            className={cn(
              'size-3 transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
            strokeWidth={2.5}
          />
        </button>
      )}
      {isOpen && (
        <div
          ref={popoverRef}
          id="expandable-popover"
          className="absolute z-50 left-0 top-full mt-1 min-w-max max-w-xs sm:max-w-sm"
        >
          <div className="rounded-md border bg-popover p-2.5 shadow-md text-sm">
            {textContent}
          </div>
        </div>
      )}
    </div>
  )
}

const InlineVariant = function InlineVariant({
  maxLines,
  showIndicator,
  className,
  isOverflowing,
  contentRef,
  children,
}: {
  maxLines: number
  showIndicator: boolean
  className?: string
  isOverflowing: boolean
  contentRef: React.RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  const handleToggle = () => {
    setIsExpanded((prev) => !prev)
  }

  const handleKeyDown = activateOnEnterOrSpace(handleToggle)

  return (
    <div
      className={cn(
        'inline-flex items-start gap-1 min-w-0',
        isOverflowing && 'cursor-pointer'
      )}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={isOverflowing ? 0 : -1}
      aria-expanded={isExpanded}
    >
      <span
        ref={contentRef}
        className={cn(className, !isExpanded && 'truncate')}
        style={
          !isExpanded ? getLineClampStyle(maxLines) : { display: 'inline' }
        }
      >
        {children}
      </span>
      {isOverflowing && showIndicator && !isExpanded && (
        <ChevronDown className="size-3 shrink-0 mt-0.5" strokeWidth={2.5} />
      )}
    </div>
  )
}

export const ExpandableText = function ExpandableText({
  children,
  variant = 'popover',
  maxLines = 1,
  showIndicator = true,
  className,
}: ExpandableTextProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isMeasured, setIsMeasured] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measuring on children/content change is intentional
  useEffect(() => {
    const element = contentRef.current
    if (!element) return

    const measureOverflow = () => {
      setIsOverflowing(checkOverflow(element))
      setIsMeasured(true)
    }

    measureOverflow()

    const resizeObserver = new ResizeObserver(measureOverflow)
    resizeObserver.observe(element)

    return () => resizeObserver.disconnect()
  }, [children, maxLines])

  if (!isMeasured) {
    return (
      <span
        ref={contentRef}
        className={className}
        style={getLineClampStyle(maxLines)}
      >
        {children}
      </span>
    )
  }

  const textContent =
    typeof children === 'string'
      ? children
      : typeof children === 'number'
        ? String(children)
        : ''

  const commonProps = {
    maxLines,
    showIndicator,
    className,
    isOverflowing,
    contentRef,
  }

  if (variant === 'inline') {
    return <InlineVariant {...commonProps}>{children}</InlineVariant>
  }

  return (
    <PopoverVariant {...commonProps} textContent={textContent}>
      {children}
    </PopoverVariant>
  )
}
