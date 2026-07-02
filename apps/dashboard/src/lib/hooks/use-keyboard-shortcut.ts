import { useEffect } from 'react'

export interface KeyboardShortcutOptions {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  onKeyDown?: (event: KeyboardEvent) => void
  preventDefault?: boolean
}

/**
 * Pure predicate: does a keyboard event satisfy the requested shortcut?
 *
 * Modifier rules (each requested modifier is matched exactly):
 * - `shiftKey` / `altKey`: `event.<mod>` must equal the requested value.
 * - Meta/Ctrl, cross-platform aware:
 *   - BOTH requested → "Cmd on mac / Ctrl on win": match when EITHER
 *     `event.metaKey` or `event.ctrlKey` is held.
 *   - only `metaKey` → require `event.metaKey` and forbid `event.ctrlKey`.
 *   - only `ctrlKey` → require `event.ctrlKey` and forbid `event.metaKey`.
 *   - NEITHER → forbid both meta and ctrl.
 */
export function matchesKeyboardShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
  >,
  options: Pick<
    KeyboardShortcutOptions,
    'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
  >
): boolean {
  const {
    key,
    metaKey = false,
    ctrlKey = false,
    shiftKey = false,
    altKey = false,
  } = options

  const keyMatches = event.key.toLowerCase() === key.toLowerCase()

  // Meta/Ctrl matching with cross-platform support.
  let metaCtrlMatches: boolean
  if (metaKey && ctrlKey) {
    // Cross-platform "Cmd/Ctrl": either modifier satisfies the shortcut.
    metaCtrlMatches = event.metaKey || event.ctrlKey
  } else if (metaKey) {
    metaCtrlMatches = event.metaKey && !event.ctrlKey
  } else if (ctrlKey) {
    metaCtrlMatches = event.ctrlKey && !event.metaKey
  } else {
    metaCtrlMatches = !event.metaKey && !event.ctrlKey
  }

  const shiftMatches = event.shiftKey === shiftKey
  const altMatches = event.altKey === altKey

  return keyMatches && metaCtrlMatches && shiftMatches && altMatches
}

/**
 * Hook to register keyboard shortcuts
 * @param options - Shortcut configuration
 * @param dependencies - Dependencies for the callback
 */
export function useKeyboardShortcut(
  options: KeyboardShortcutOptions,
  dependencies: unknown[] = []
) {
  const {
    key,
    metaKey = false,
    ctrlKey = false,
    shiftKey = false,
    altKey = false,
    onKeyDown,
    preventDefault = true,
  } = options

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        matchesKeyboardShortcut(event, {
          key,
          metaKey,
          ctrlKey,
          shiftKey,
          altKey,
        })
      ) {
        if (preventDefault) {
          event.preventDefault()
        }
        onKeyDown?.(event)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    altKey,
    onKeyDown,
    preventDefault,
    ...dependencies,
  ])
}
