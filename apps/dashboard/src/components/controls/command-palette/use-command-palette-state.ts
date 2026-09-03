import type { RecentPaletteItemKind } from '@/lib/command-palette/recent-items'
import type { PaletteTab } from '../command-palette-utils'

import * as React from 'react'
import { useEffect, useState } from 'react'
import {
  addRecentItem,
  getRecentItems,
} from '@/lib/command-palette/recent-items'

/**
 * Open/controlled state, the search input value, the "mounted" flag (avoids a
 * theme-icon hydration mismatch), and recent-items persistence for the
 * command palette. Extracted so `CommandPalette` composes state instead of
 * declaring a dozen independent sources inline.
 */
export function useCommandPaletteState({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [inputValue, setInputValue] = useState('')
  const [tab, setTab] = useState<PaletteTab>('all')
  const [recentItems, setRecentItems] = useState<
    ReturnType<typeof getRecentItems>
  >([])
  const [mounted, setMounted] = useState(false)

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  useEffect(() => {
    setMounted(true)
  }, [])

  // Recent items can be added from any palette instance (or a prior session),
  // so re-read them each time the palette opens rather than only on mount.
  useEffect(() => {
    if (open) setRecentItems(getRecentItems())
  }, [open])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  /** Close the palette and reset the search input — the common "act on a selection" tail. */
  const closeAndReset = () => {
    setOpen(false)
    setInputValue('')
    setTab('all')
  }

  const rememberSelection = (
    id: string,
    title: string,
    href: string,
    kind: RecentPaletteItemKind,
    description?: string
  ) => {
    addRecentItem({ id, title, href, kind, description })
  }

  return {
    open,
    setOpen,
    inputValue,
    setInputValue,
    tab,
    setTab,
    recentItems,
    mounted,
    closeAndReset,
    rememberSelection,
  }
}
