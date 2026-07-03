/**
 * Dashboard Storage — public entrypoint.
 *
 * Provides save/load/list/delete/share operations for Chart Builder
 * configurations ("dashboards": a named, ordered list of chart ids).
 *
 * Backend selection mirrors
 * `conversation-store/adapter/resolve-thread-list-adapter.ts`:
 *   - D1 available (Cloudflare deployment with conversation/dashboard
 *     storage enabled) → persisted server-side per owner, synced across
 *     devices, with optional read-only sharing.
 *   - Otherwise (self-hosted/Docker, or D1 disabled) → localStorage, scoped
 *     to the browser profile.
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
export async function loadDashboard(name: string): Promise<string[] | null> {
  return resolveDashboardBackend() === 'd1'
    ? loadDashboardRemote(name)
    : loadDashboardLocal(name)
}

/**
 * Save a dashboard configuration under the given name. Overwrites any
 * existing dashboard with the same name.
 */
export async function saveDashboard(
  name: string,
  charts: string[]
): Promise<void> {
  if (resolveDashboardBackend() === 'd1') {
    await saveDashboardRemote(name, charts)
  } else {
    saveDashboardLocal(name, charts)
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
