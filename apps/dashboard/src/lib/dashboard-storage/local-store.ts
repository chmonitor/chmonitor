/**
 * Dashboard Storage - localStorage persistence for saved dashboards
 *
 * Provides save/load/list/delete operations for dashboard grid layouts
 * (plan 57: `DashboardLayout`, a positioned list of widgets). Data is stored
 * under a single JSON key in localStorage, one entry per dashboard name.
 * Values written before plan 57 are the legacy bare `charts: string[]`
 * shape — `loadDashboardLocal` runs every stored value through
 * `normalizeLayout` so an old browser-local save keeps loading correctly.
 *
 * This is the OSS/self-hosted default (no owner/sharing concept — a single
 * browser profile IS the scope) and the fail-open fallback for cloud
 * deployments where D1 storage is unavailable or disabled. See `index.ts`
 * for the async wrapper that picks between this and the D1-backed remote
 * store.
 */

import type { DashboardLayout } from '@/types/dashboard-layout'

import { normalizeLayout } from '@/types/dashboard-layout'

const STORAGE_KEY = 'clickhouse-monitor-dashboards'

// Values are `DashboardLayout` going forward; a legacy bare `string[]` may
// still be present from before plan 57 — `normalizeLayout` upgrades either
// shape on read.
type DashboardStore = Record<string, unknown>

function readStore(): DashboardStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as DashboardStore
  } catch {
    return {}
  }
}

function writeStore(store: DashboardStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // localStorage may be full or unavailable (e.g. private browsing)
  }
}

/**
 * Save a dashboard layout under the given name.
 * Overwrites any existing dashboard with the same name.
 */
export function saveDashboardLocal(
  name: string,
  layout: DashboardLayout
): void {
  const store = readStore()
  store[name] = layout
  writeStore(store)
}

/**
 * Load a saved dashboard by name. Returns null if the dashboard does not
 * exist. Runs the stored value through `normalizeLayout` so a legacy
 * (pre-plan-57) bare `string[]` value is transparently upgraded.
 */
export function loadDashboardLocal(name: string): DashboardLayout | null {
  const store = readStore()
  if (!Object.hasOwn(store, name)) return null
  return normalizeLayout(store[name])
}

/**
 * List all saved dashboard names, sorted alphabetically.
 */
export function listDashboardsLocal(): string[] {
  return Object.keys(readStore()).sort()
}

/**
 * Delete a saved dashboard by name.
 */
export function deleteDashboardLocal(name: string): void {
  const store = readStore()
  delete store[name]
  writeStore(store)
}
