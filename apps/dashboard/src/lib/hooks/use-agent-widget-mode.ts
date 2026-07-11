'use client'

/**
 * useAgentWidgetMode Hook
 *
 * Remembers whether the floating agent widget is shown as the small bottom-right
 * popover (`floating`) or docked as a full-height right sidebar (`docked`).
 * Persisted to localStorage so the preferred layout survives reloads and is
 * shared across tabs of the same browser.
 */

import { useEffect, useState } from 'react'

export type AgentWidgetMode = 'floating' | 'docked'

const WIDGET_MODE_STORAGE_KEY = 'clickhouse-monitor-agent-widget-mode'
const WIDGET_MODE_CHANGE_EVENT = 'clickhouse-monitor-agent-widget-mode-changed'

const DEFAULT_MODE: AgentWidgetMode = 'floating'

function isWidgetMode(value: string | null): value is AgentWidgetMode {
  return value === 'floating' || value === 'docked'
}

function getSavedMode(): AgentWidgetMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const saved = localStorage.getItem(WIDGET_MODE_STORAGE_KEY)
    if (isWidgetMode(saved)) return saved
  } catch {
    // localStorage may be disabled
  }
  return DEFAULT_MODE
}

function saveMode(mode: AgentWidgetMode): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WIDGET_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage may be disabled
  }
}

function emitModeChange(mode: AgentWidgetMode): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<AgentWidgetMode>(WIDGET_MODE_CHANGE_EVENT, { detail: mode })
  )
}

export interface UseAgentWidgetModeResult {
  mode: AgentWidgetMode
  isDocked: boolean
  setMode: (mode: AgentWidgetMode) => void
  toggleMode: () => void
}

/**
 * Manages the floating-vs-docked layout of the agent widget. Writing the mode
 * persists it and broadcasts a custom event so any other consumer in the tab
 * stays in sync without a reload.
 */
export function useAgentWidgetMode(): UseAgentWidgetModeResult {
  const [mode, setModeState] = useState<AgentWidgetMode>(() => getSavedMode())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AgentWidgetMode>).detail
      setModeState(isWidgetMode(detail) ? detail : getSavedMode())
    }
    window.addEventListener(WIDGET_MODE_CHANGE_EVENT, handler)
    return () => window.removeEventListener(WIDGET_MODE_CHANGE_EVENT, handler)
  }, [])

  const setMode = (next: AgentWidgetMode): void => {
    saveMode(next)
    setModeState(next)
    emitModeChange(next)
  }

  const toggleMode = (): void => {
    setMode(mode === 'docked' ? 'floating' : 'docked')
  }

  return { mode, isDocked: mode === 'docked', setMode, toggleMode }
}
