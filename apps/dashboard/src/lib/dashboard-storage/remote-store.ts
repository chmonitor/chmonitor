/**
 * Client-side fetch wrappers for the D1-backed dashboard API
 * (`/api/dashboards/*`). Used by `index.ts` when the D1 backend is active
 * (see `resolveDashboardBackend`). Client-safe: no `@chm/platform` / D1
 * import here — only `fetch` against the app's own API routes, mirroring
 * `conversation-store/adapter/d1-thread-list-adapter.tsx`.
 */

import { apiFetch } from '@/lib/swr/api-fetch'

const BASE = '/api/dashboards'

interface DashboardListItem {
  name: string
  charts: string[]
}

function unwrap(json: unknown): Record<string, unknown> {
  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    if (record.data && typeof record.data === 'object') {
      return record.data as Record<string, unknown>
    }
    return record
  }
  return {}
}

/** List saved dashboard names (sorted server-side). */
export async function listDashboardsRemote(): Promise<string[]> {
  const res = await apiFetch(`${BASE}/list`)
  if (!res.ok) {
    throw new Error(`Failed to list dashboards (${res.status})`)
  }
  const body = unwrap(await res.json().catch(() => ({})))
  const dashboards = body.dashboards
  if (!Array.isArray(dashboards)) return []
  return dashboards
    .filter(
      (d): d is DashboardListItem =>
        !!d &&
        typeof d === 'object' &&
        typeof (d as DashboardListItem).name === 'string'
    )
    .map((d) => d.name)
}

/** Load a saved dashboard's chart list by name. Returns null if not found. */
export async function loadDashboardRemote(
  name: string
): Promise<string[] | null> {
  const res = await apiFetch(`${BASE}/list`)
  if (!res.ok) {
    throw new Error(`Failed to load dashboard (${res.status})`)
  }
  const body = unwrap(await res.json().catch(() => ({})))
  const dashboards = body.dashboards
  if (!Array.isArray(dashboards)) return null
  const match = dashboards.find(
    (d): d is DashboardListItem =>
      !!d && typeof d === 'object' && (d as DashboardListItem).name === name
  )
  return match ? match.charts : null
}

/** Save (create or overwrite) a dashboard by name. */
export async function saveDashboardRemote(
  name: string,
  charts: string[]
): Promise<void> {
  const res = await apiFetch(`${BASE}/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, charts }),
  })
  if (!res.ok) {
    throw new Error(
      `Dashboard save failed (${res.status}): ${await res.text().catch(() => 'unknown')}`
    )
  }
}

/** Delete a dashboard by name. */
export async function deleteDashboardRemote(name: string): Promise<void> {
  const res = await apiFetch(
    `${BASE}/delete?name=${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  )
  if (!res.ok) {
    throw new Error(`Dashboard delete failed (${res.status})`)
  }
}

/** Enable read-only sharing for a dashboard. Returns the public share slug. */
export async function shareDashboardRemote(name: string): Promise<string> {
  const res = await apiFetch(`${BASE}/share`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw new Error(`Dashboard share failed (${res.status})`)
  }
  const body = unwrap(await res.json().catch(() => ({})))
  const slug = body.shareSlug
  if (typeof slug !== 'string') {
    throw new Error('Dashboard share response missing shareSlug')
  }
  return slug
}

/** Revoke read-only sharing for a dashboard. */
export async function unshareDashboardRemote(name: string): Promise<void> {
  const res = await apiFetch(`${BASE}/share?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    throw new Error(`Dashboard unshare failed (${res.status})`)
  }
}
