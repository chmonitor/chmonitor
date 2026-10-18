'use client'

import { useEffect, useState } from 'react'

const TOOL_CONFIG_STORAGE_KEY = 'clickhouse-monitor-tool-config'

type ToolConfigStorage = {
  disabled: string[]
}

function readStorage(): ToolConfigStorage {
  if (typeof window === 'undefined') return { disabled: [] }
  try {
    const raw = localStorage.getItem(TOOL_CONFIG_STORAGE_KEY)
    if (!raw) return { disabled: [] }
    const parsed = JSON.parse(raw) as ToolConfigStorage
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] }
  } catch {
    return { disabled: [] }
  }
}

function writeStorage(config: ToolConfigStorage): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(TOOL_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage may be disabled
  }
}

export interface UseToolConfigResult {
  isToolEnabled: (toolName: string) => boolean
  toggleTool: (toolName: string) => void
  enableTool: (toolName: string) => void
  disableTool: (toolName: string) => void
  enableAll: () => void
  disabledTools: readonly string[]
  getEnabledTools: (allToolNames: string[]) => string[]
}

export function useToolConfig(): UseToolConfigResult {
  const [disabledTools, setDisabledTools] = useState<string[]>(() => {
    return readStorage().disabled
  })

  useEffect(() => {
    writeStorage({ disabled: disabledTools })
  }, [disabledTools])

  const isToolEnabled = (toolName: string) => !disabledTools.includes(toolName)

  const toggleTool = (toolName: string) => {
    setDisabledTools((prev) =>
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    )
  }

  const enableTool = (toolName: string) => {
    setDisabledTools((prev) => prev.filter((t) => t !== toolName))
  }

  const disableTool = (toolName: string) => {
    setDisabledTools((prev) =>
      prev.includes(toolName) ? prev : [...prev, toolName]
    )
  }

  const enableAll = () => {
    setDisabledTools([])
  }

  const getEnabledTools = (allToolNames: string[]) =>
    allToolNames.filter((name) => !disabledTools.includes(name))

  return {
    isToolEnabled,
    toggleTool,
    enableTool,
    disableTool,
    enableAll,
    disabledTools,
    getEnabledTools,
  }
}
