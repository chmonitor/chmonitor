/**
 * Dashboard Storage — public entrypoint.
 *
 * Provides save/load/list/delete/share operations for Chart Builder
 * configurations ("dashboards": a named, ordered list of chart ids).
 *
 * Backend selection mirrors
 * `conversation-store/adapter/resolve-thread-list-adapter.ts`:
 *   - Server-side storage enabled → persisted server-side per owner, synced
 *     across devices, with optional read-only sharing. The actual server
 *     backend (D1 on Cloudflare, or ClickHouse/Postgres on self-hosted —
 *     see `resolve-server-store.ts`) is resolved inside the
 *     `/api/dashboards/*` routes; the client only knows "remote vs local".
 *   - Otherwise → localStorage, scoped to the browser profile.
 *
 * Deliberately reuses `featureFlags.conversationDb()` rather than adding a
 * dedicated `dashboardDb` flag: both features persist into the same
 * `CHM_CLOUD_D1` database behind the same Clerk-required gate, so a second
 * flag would just duplicate this check without changing its meaning. See
 * plans/56-dashboard-d1-persistence-sharing.md.
 *
 * Client-safe: this module (and everything it imports) must never pull in
 * `d1-store.ts` / `auth.ts` (server-only — they import `@chm/platform` and
 * the Clerk server SDK). The D1 backend is reached only indirectly, through
 * the `/api/dashboards/*` routes called by `remote-store.ts`.
 */

import type { DashboardLayout } from '@/types/dashboard-layout'

import {
  deleteDashboardLocal,
  listDashboardsLocal,
  loadDashboardLocal,
  saveDashboardLocal,
} from './local-store'
import {
  deleteDashboardRemote,
  listDashboardsRemote,
  loadDashboardRemote,
  saveDashboardRemote,
  shareDashboardRemote,
  unshareDashboardRemote,
} from './remote-store'
import { featureFlags } from '@/lib/feature-flags'

export type DashboardBackend = 'd1' | 'local'

/**
 * sessionStorage key the dashboard route reads its unsaved "current working
 * layout" from (see `routes/(dashboard)/dashboard.tsx`). Exported so other
 * surfaces — e.g. the AI agent's "Apply to dashboard" suggestion action in
 * `agent-dashboard-suggestion.tsx` — can load a layout into the live grid
 * without importing the route module itself.
 */
export const DASHBOARD_SESSION_KEY = 'dashboard-current-layout'

/**
 * Returns `'d1'` when server-side dashboard storage is enabled, otherwise
 * `'local'`.
 */
export function resolveDashboardBackend(): DashboardBackend {
  try {
    return featureFlags.conversationDb() ? 'd1' : 'local'
  } catch {
    return 'local'
  }
}

/**
 * List all saved dashboard names, sorted alphabetically.
 */
export async function listDashboards(): Promise<string[]> {
  return resolveDashboardBackend() === 'd1'
    ? listDashboardsRemote()
    : listDashboardsLocal()
}

/**
 * Load a saved dashboard by name. Returns null if the dashboard does not
 * exist.
 */
export async function loadDashboard(
  name: string
): Promise<DashboardLayout | null> {
  return resolveDashboardBackend() === 'd1'
    ? loadDashboardRemote(name)
    : loadDashboardLocal(name)
}

/**
 * Save a dashboard layout under the given name. Overwrites any existing
 * dashboard with the same name.
 */
export async function saveDashboard(
  name: string,
  layout: DashboardLayout
): Promise<void> {
  if (resolveDashboardBackend() === 'd1') {
    await saveDashboardRemote(name, layout)
  } else {
    saveDashboardLocal(name, layout)
  }
}

/**
 * Delete a saved dashboard by name.
 */
export async function deleteDashboard(name: string): Promise<void> {
  if (resolveDashboardBackend() === 'd1') {
    await deleteDashboardRemote(name)
  } else {
    deleteDashboardLocal(name)
  }
}

/**
 * Enable read-only sharing for a dashboard, returning its public share slug.
 * Sharing requires server-side (D1) storage — there is no meaningful "share"
 * concept for a single browser's localStorage, so this throws when the
 * local backend is active rather than silently no-op'ing.
 */
export async function shareDashboard(name: string): Promise<string> {
  if (resolveDashboardBackend() !== 'd1') {
    throw new Error(
      'Sharing requires server-side dashboard storage, which is not enabled for this deployment.'
    )
  }
  return shareDashboardRemote(name)
}

/**
 * Revoke read-only sharing for a dashboard.
 */
export async function unshareDashboard(name: string): Promise<void> {
  if (resolveDashboardBackend() !== 'd1') {
    throw new Error(
      'Sharing requires server-side dashboard storage, which is not enabled for this deployment.'
    )
  }
  await unshareDashboardRemote(name)
}
