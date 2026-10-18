/**
 * One config lives in a module-level store per tab and is read through
 * `useSyncExternalStore`, so every consumer in the tab — the settings panel the
 * user edits and the agent runtime that decides which servers to connect to —
 * reads the same value and a toggle reaches the next agent request without a
 * reload. A `storage` listener alone would not do: it only fires in *other*
 * tabs, and both of those consumers are in this one.
 *
 * The built-in `clickhouse-monitor` server is provided by the caller and is
 * never stored here; only user overrides (toggles + custom servers) persist.
 */

'use client'

import type { McpServer } from '@/components/agents/welcome/mcp-types'

import { useSyncExternalStore } from 'react'

export const MCP_CONFIG_STORAGE_KEY = 'clickhouse-monitor-mcp-config'

export interface CustomMcpServer {
  id: string
  name: string
  endpoint: string
}

export interface McpConfigStorage {
  disabled: string[]
  customServers: CustomMcpServer[]
}

const EMPTY: McpConfigStorage = { disabled: [], customServers: [] }

export function withServerEnabled(
  config: McpConfigStorage,
  id: string,
  enabled: boolean
): McpConfigStorage {
  return {
    ...config,
    disabled: enabled
      ? config.disabled.filter((s) => s !== id)
      : config.disabled.includes(id)
        ? config.disabled
        : [...config.disabled, id],
  }
}

export function createCustomServer(
  server: Omit<CustomMcpServer, 'id'>
): CustomMcpServer {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: server.name,
    endpoint: server.endpoint,
  }
}

export function withAddedServer(
  config: McpConfigStorage,
  server: Omit<CustomMcpServer, 'id'>
): { config: McpConfigStorage; created: CustomMcpServer } {
  const created = createCustomServer(server)
  return {
    config: { ...config, customServers: [...config.customServers, created] },
    created,
  }
}

export function withRemovedServer(
  config: McpConfigStorage,
  id: string
): McpConfigStorage {
  return {
    disabled: config.disabled.filter((s) => s !== id),
    customServers: config.customServers.filter((s) => s.id !== id),
  }
}

function readStorage(): McpConfigStorage {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(MCP_CONFIG_STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<McpConfigStorage>
    return {
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
      customServers: Array.isArray(parsed.customServers)
        ? parsed.customServers
        : [],
    }
  } catch {
    return EMPTY
  }
}

function writeStorage(config: McpConfigStorage): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MCP_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage may be disabled
  }
}

const listeners = new Set<() => void>()

/**
 * Cached snapshot, `undefined` until first read so localStorage is touched
 * after hydration rather than at import. Replaced only on write:
 * `useSyncExternalStore` compares snapshots by reference, so building a fresh
 * object per call would re-render forever.
 */
let snapshot: McpConfigStorage | undefined

function getSnapshot(): McpConfigStorage {
  snapshot ??= readStorage()
  return snapshot
}

// SSR has no localStorage; render empty, then pick up the stored config.
function getServerSnapshot(): McpConfigStorage {
  return EMPTY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setSnapshot(next: McpConfigStorage): void {
  snapshot = next
  writeStorage(next)
  for (const listener of listeners) listener()
}

export interface UseMcpConfigResult {
  disabledServers: readonly string[]
  customServers: readonly CustomMcpServer[]
  isServerEnabled: (id: string) => boolean
  setServerEnabled: (id: string, enabled: boolean) => void
  addServer: (server: Omit<CustomMcpServer, 'id'>) => CustomMcpServer
  removeServer: (id: string) => void
}

export function useMcpConfig(): UseMcpConfigResult {
  const config = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const isServerEnabled = (id: string) => !config.disabled.includes(id)

  // Every write reads the live snapshot rather than a captured `config`, so
  // two changes landing in one tick compose instead of overwriting each other.
  const setServerEnabled = (id: string, enabled: boolean) => {
    setSnapshot(withServerEnabled(getSnapshot(), id, enabled))
  }

  const addServer = (server: Omit<CustomMcpServer, 'id'>): CustomMcpServer => {
    const { config: next, created } = withAddedServer(getSnapshot(), server)
    setSnapshot(next)
    return created
  }

  const removeServer = (id: string) => {
    setSnapshot(withRemovedServer(getSnapshot(), id))
  }

  return {
    disabledServers: config.disabled,
    customServers: config.customServers,
    isServerEnabled,
    setServerEnabled,
    addServer,
    removeServer,
  }
}

export function toMcpServers(
  customServers: readonly CustomMcpServer[],
  isServerEnabled: (id: string) => boolean
): McpServer[] {
  return customServers.map((s) => ({
    id: s.id,
    name: s.name,
    endpoint: s.endpoint,
    toolCount: 0,
    builtin: false,
    enabled: isServerEnabled(s.id),
    status: 'unconfigured' as const,
  }))
}

/**
 * The `{active}/{total}` pair behind both the sidebar's collapsed header badge
 * and the panel's summary row, so the two can never disagree. The built-in
 * `clickhouse-monitor` server is always on and always registered, so it
 * contributes 1 to both totals.
 */
export function mcpServerCounts(
  customServers: readonly CustomMcpServer[],
  isServerEnabled: (id: string) => boolean
): { active: number; total: number } {
  return {
    active: customServers.filter((s) => isServerEnabled(s.id)).length + 1,
    total: customServers.length + 1,
  }
}
