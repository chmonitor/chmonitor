import { useShortcutHandlers } from './hooks/use-shortcut-handlers'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { useState } from 'react'
import { useKeyboardShortcut } from '@/lib/hooks/use-keyboard-shortcut'

/**
 * Global keyboard shortcuts for the chmonitor dashboard
 *
 * Shortcuts:
 * - Cmd/Ctrl + K: Open command palette (handled by CommandPalette component)
 * - Cmd/Ctrl + G: Go to overview
 * - Cmd/Ctrl + Q: Go to running queries
 * - Cmd/Ctrl + D: Go to database tables
 * - Cmd/Ctrl + R: Refresh current page data
 * - Cmd/Ctrl + /: Show keyboard shortcuts help
 * - Escape: Close modals/dialogs
 *
 * @example
 * ```tsx
 * import { KeyboardShortcuts } from '@/components/controls/keyboard-shortcuts'
 *
 * export function Layout({ children }) {
 *   return (
 *     <>
 *       <KeyboardShortcuts />
 *       {children}
 *     </>
 *   )
 * }
 * ```
 */
export const KeyboardShortcuts = () => {
  const [showHelp, setShowHelp] = useState(false)
  const { goToOverview, goToQueries, goToTables, triggerRevalidate } =
    useShortcutHandlers()

  // Register keyboard shortcuts
  useKeyboardShortcut({
    key: 'g',
    metaKey: true,
    ctrlKey: true,
    onKeyDown: goToOverview,
  })

  useKeyboardShortcut({
    key: 'q',
    metaKey: true,
    ctrlKey: true,
    onKeyDown: goToQueries,
  })

  useKeyboardShortcut({
    key: 'd',
    metaKey: true,
    ctrlKey: true,
    onKeyDown: goToTables,
  })

  useKeyboardShortcut({
    key: 'r',
    metaKey: true,
    ctrlKey: true,
    onKeyDown: triggerRevalidate,
  })

  const showShortcuts = () => {
    setShowHelp(true)
  }

  useKeyboardShortcut({
    key: '/',
    metaKey: true,
    ctrlKey: true,
    onKeyDown: showShortcuts,
  })

  return <KeyboardShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />
}
