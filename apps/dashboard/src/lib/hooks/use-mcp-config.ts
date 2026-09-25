/**
 * useMcpConfig Hook
 *
 * Manages MCP server configuration for the agent:
 *   - Enabled/disabled state per server (toggle state)
 *   - User-added custom servers
 *
 * One config lives in a module-level store per tab and is read through
 * `useSyncExternalStore`, so every consumer in the tab — the settings panel the
 * user edits and the agent runtime that decides which servers to connect to —
 * reads the same value and a toggle reaches the next agent request without a
 * reload. A `storage` listener alone would not do: it only fires in *other*
 * tabs, and both of those consumers are in this one.
 *
 * The store persists to localStorage so the configuration survives page reloads
 * — mirrors the `useToolConfig` pattern used for individual MCP tools. The
 * built-in `clickhouse-monitor` server is provided by the caller and is never
 * stored here; only user overrides (toggles + custom servers) live in
 * localStorage.
 *
 * Same external-store shape as the other module-level snapshot stores
 * (`lib/traffic/traffic-settings.ts`, `lib/menu/favorites-store.ts`).
 */

'use client'

import type { McpServer } from '@/components/agents/welcome/mcp-types'

import { useSyncExternalStore } from 'react'

export const MCP_CONFIG_STORAGE_KEY = 'clickhouse-monitor-mcp-config'

/** Custom server fields the user supplies when registering a new server. */
export interface CustomMcpServer {
  id: string
  name: string
  endpoint: string
}

export interface McpConfigStorage {
  /** Server ids the user has explicitly disabled. Absent means enabled. */
  disabled: string[]
  /** User-added custom servers, beyond the built-in one. */
  customServers: CustomMcpServer[]
}

const EMPTY: McpConfigStorage = { disabled: [], customServers: [] }

// ---------------------------------------------------------------------------
// Pure state transitions — exported so they can be unit-tested without a DOM.
// ---------------------------------------------------------------------------

/** Toggle the enabled state of a server, returning a new config. */
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

/** Create a custom server with a freshly generated unique id. */
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

/** Append a custom server, returning the new config and the created server. */
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

/** Remove a custom server and any toggle override for it. */
export function withRemovedServer(
  config: McpConfigStorage,
  id: string
): McpConfigStorage {
  return {
    disabled: config.disabled.filter((s) => s !== id),
    customServers: config.customServers.filter((s) => s.id !== id),
  }
}

/** Read the persisted config from localStorage; SSR-safe and fault-tolerant. */
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

/** Persist the config to localStorage; SSR-safe and fault-tolerant. */
function writeStorage(config: McpConfigStorage): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MCP_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage may be disabled
  }
}

// ---------------------------------------------------------------------------
// Tab-wide store — the single source both the settings panel and the agent
// runtime read, so a toggle made in one reaches the other without a reload.
// ---------------------------------------------------------------------------

/** Same-tab subscribers to re-render on change. */
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

/** SSR has no localStorage; render empty, then pick up the stored config. */
function getServerSnapshot(): McpConfigStorage {
  return EMPTY
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Commit a config: cache it, persist it, then notify this tab's consumers. */
function setSnapshot(next: McpConfigStorage): void {
  snapshot = next
  writeStorage(next)
  for (const listener of listeners) listener()
}

export interface UseMcpConfigResult {
  /** Server ids the user has disabled. */
  disabledServers: readonly string[]
  /** User-added custom servers. */
  customServers: readonly CustomMcpServer[]
  /** Check if a server is enabled (defaults to true for unknown ids). */
  isServerEnabled: (id: string) => boolean
  /** Set the enabled state of a server. */
  setServerEnabled: (id: string, enabled: boolean) => void
  /** Register a new custom server. Returns the created server. */
  addServer: (server: Omit<CustomMcpServer, 'id'>) => CustomMcpServer
  /** Remove a custom server and any toggle override for it. */
  removeServer: (id: string) => void
}

/**
 * Hook for managing MCP server configuration.
 *
 * By default all servers are enabled. Every caller in the tab reads the same
 * store, so the panel's list and the agent's effective server set cannot
 * disagree. Toggle state and custom servers persist in localStorage so the
 * configuration is restored on reload.
 */
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

/** Build the display list of {@link McpServer}s from persisted config. */
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
