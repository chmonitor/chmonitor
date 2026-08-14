import { GripVertical } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'sidebar-width'
const DEFAULT_WIDTH = 256 // 16rem
const MIN_WIDTH = 80
const MAX_WIDTH = 400
const COLLAPSE_THRESHOLD = 120 // Drag below this to collapse

interface ResizableSidebarProviderProps {
  children: React.ReactNode
  defaultOpen?: boolean
}

function ResizeHandle() {
  const { state, setOpen } = useSidebar()
  const [isResizing, setIsResizing] = useState(false)
  const [currentWidth, setCurrentWidth] = useState(DEFAULT_WIDTH)
  const startXRef = useRef(0)
  const startWidthRef = useRef(DEFAULT_WIDTH)
  const shouldCollapseRef = useRef(false)

  // Sync current width on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const width = parseInt(saved, 10)
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
        setCurrentWidth(width)
      }
    }
  }, [])

  const applyWidth = (newWidth: number, persist: boolean) => {
    const wrapper = document.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement | null
    if (!wrapper) return
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth))
    wrapper.style.setProperty('--sidebar-width', `${clamped}px`)
    setCurrentWidth(clamped)
    if (persist) {
      localStorage.setItem(STORAGE_KEY, clamped.toString())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (state === 'collapsed') return
      const next = currentWidth - step
      if (next < COLLAPSE_THRESHOLD) {
        setOpen(false)
        return
      }
      applyWidth(next, true)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (state === 'collapsed') {
        setOpen(true)
        applyWidth(Math.max(currentWidth, DEFAULT_WIDTH), true)
        return
      }
      applyWidth(currentWidth + step, true)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setOpen(true)
      applyWidth(MIN_WIDTH, true)
    } else if (e.key === 'End') {
      e.preventDefault()
      setOpen(true)
      applyWidth(MAX_WIDTH, true)
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const wrapper = document.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    if (!wrapper) return

    setIsResizing(true)
    shouldCollapseRef.current = false
    startXRef.current = e.clientX

    // If collapsed, we're expanding - start from icon width
    if (state === 'collapsed') {
      startWidthRef.current = 48 // icon width (3rem)
    } else {
      const currentWidth =
        getComputedStyle(wrapper).getPropertyValue('--sidebar-width')
      startWidthRef.current = parseInt(currentWidth, 10) || DEFAULT_WIDTH
    }
  }

  useEffect(() => {
    if (!isResizing) return

    const wrapper = document.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    if (!wrapper) return

    // Disable transitions during resize for instant feedback
    wrapper.setAttribute('data-resizing', 'true')

    // If starting from collapsed, expand first
    if (state === 'collapsed') {
      setOpen(true)
    }

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current
      const rawWidth = startWidthRef.current + delta
      const hasDraggedEnough = Math.abs(delta) > 10 // Minimum 10px drag

      // Check if should collapse - only if dragged enough to the left
      if (hasDraggedEnough && rawWidth < COLLAPSE_THRESHOLD) {
        shouldCollapseRef.current = true
        // Show visual feedback - clamp to minimum visible
        wrapper.style.setProperty('--sidebar-width', `${COLLAPSE_THRESHOLD}px`)
        setCurrentWidth(COLLAPSE_THRESHOLD)
      } else {
        shouldCollapseRef.current = false
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth))
        wrapper.style.setProperty('--sidebar-width', `${newWidth}px`)
        setCurrentWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      wrapper.removeAttribute('data-resizing')

      if (shouldCollapseRef.current) {
        // Collapse the sidebar
        setOpen(false)
        // Restore saved width for when it reopens
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          wrapper.style.setProperty('--sidebar-width', `${saved}px`)
        }
      } else {
        const width =
          getComputedStyle(wrapper).getPropertyValue('--sidebar-width')
        const parsedWidth = parseInt(width, 10)
        if (parsedWidth >= MIN_WIDTH) {
          localStorage.setItem(STORAGE_KEY, parsedWidth.toString())
          setCurrentWidth(parsedWidth)
        }
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      wrapper.removeAttribute('data-resizing')
    }
  }, [isResizing, setOpen, state])

  // Position based on state - center on sidebar edge
  // Collapsed width from sidebar.tsx: calc(var(--sidebar-width-icon)+(--spacing(4))+2px)
  const leftPosition =
    state === 'collapsed'
      ? 'calc(var(--sidebar-width-icon) + 2rem)'
      : 'var(--sidebar-width)'

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={currentWidth}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      className="group fixed top-0 bottom-0 z-20 hidden w-4 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none md:flex"
      style={{ left: leftPosition }}
    >
      {/* Grip icon */}
      <div
        className={cn(
          'relative flex h-6 w-4 items-center justify-center rounded-sm opacity-0 transition-opacity',
          'group-hover:opacity-100 group-focus-visible:opacity-100',
          'group-focus-visible:ring-2 group-focus-visible:ring-ring',
          isResizing && 'opacity-100'
        )}
      >
        <GripVertical className="size-3 text-muted-foreground" aria-hidden />
      </div>
    </div>
  )
}

export function ResizableSidebarProvider({
  children,
  defaultOpen = true,
}: ResizableSidebarProviderProps) {
  const [sidebarWidth, setSidebarWidth] = useState<string>(`${DEFAULT_WIDTH}px`)
  const [mounted, setMounted] = useState(false)

  // Load saved width on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const width = parseInt(saved, 10)
      if (width >= MIN_WIDTH && width <= MAX_WIDTH) {
        setSidebarWidth(`${width}px`)
      }
    }
    setMounted(true)
  }, [])

  // Prevent flash by not rendering until mounted
  if (!mounted) {
    return (
      <SidebarProvider
        defaultOpen={defaultOpen}
        style={
          { '--sidebar-width': `${DEFAULT_WIDTH}px` } as React.CSSProperties
        }
      >
        {children}
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={{ '--sidebar-width': sidebarWidth } as React.CSSProperties}
    >
      {children}
      <ResizeHandle />
    </SidebarProvider>
  )
}
