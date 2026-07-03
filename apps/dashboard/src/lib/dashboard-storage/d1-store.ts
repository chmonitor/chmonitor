/**
 * D1-based dashboard storage for Cloudflare Workers (server-only).
 *
 * Server-only: imports `@chm/platform`, which resolves to
 * `cloudflare:workers` bindings. Never import this module from client code —
 * `dashboard-storage/index.ts` (the client-facing entrypoint) must reach it
 * only indirectly, through the `/api/dashboards/*` route handlers.
 */

import type {
  DashboardStore,
  PublicSharedDashboard,
  StoredDashboard,
} from './types'

import { DashboardStoreError } from './types'
import { getPlatformBindings } from '@chm/platform'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

/**
 * D1 database row shape.
 */
interface D1DashboardRow {
  id: string
  owner_id: string
  name: string
  layout_json: string
  is_shared: number
  share_slug: string | null
  updated_at: number
}

/**
 * Upsert SQL for the `dashboards` table.
 *
 * Mirrors `conversation-store/d1-store.ts`'s `D1_UPSERT_CONVERSATION_SQL`:
 * the `ON CONFLICT` update excludes `owner_id` from `SET` and guards the
 * update with a `WHERE` clause so a conflicting row owned by a different
 * owner is never touched (0 `changes`) rather than reassigned to the caller.
 *
 * In practice the `id` passed in is never client-supplied (see
 * `saveByName`/`setSharing` below), so this guard is defense-in-depth rather
 * than the primary protection — kept to match the reused, already-proven
 * pattern rather than fork a weaker one.
 *
 * Exported so `d1-store.sql.test.ts` can run this exact string against
 * `bun:sqlite` (SQLite is D1's engine).
 */
export const D1_UPSERT_DASHBOARD_SQL = `INSERT INTO dashboards (id, owner_id, name, layout_json, is_shared, share_slug, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name,
     layout_json = excluded.layout_json,
     is_shared = excluded.is_shared,
     share_slug = excluded.share_slug,
     updated_at = excluded.updated_at
   WHERE dashboards.owner_id = excluded.owner_id`

/**
 * Owner-scoped single-row read by name. Exported so `d1-store.sql.test.ts`
 * can prove a foreign owner's row is never returned (the IDOR read-scoping
 * requirement) by running this exact string, not a re-derived guess.
 */
export const D1_GET_DASHBOARD_BY_NAME_SQL = `SELECT id, owner_id, name, layout_json, is_shared, share_slug, updated_at
   FROM dashboards
   WHERE owner_id = ?1 AND name = ?2`

/**
 * Public, unauthenticated read by share slug. Deliberately has NO owner_id
 * in the WHERE clause or projection beyond what's needed — this is the one
 * intentionally owner-unscoped query in this module. `is_shared = 1` means a
 * revoked link (which also clears `share_slug` — see `setSharing`) can never
 * match even if the slug value were somehow guessed.
 */
export const D1_GET_DASHBOARD_BY_SLUG_SQL = `SELECT name, layout_json
   FROM dashboards
   WHERE share_slug = ?1 AND is_shared = 1`

function rowToDashboard(row: D1DashboardRow): StoredDashboard {
  let charts: string[]
  try {
    const parsed = JSON.parse(row.layout_json)
    charts = Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    charts = []
  }

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    charts,
    isShared: row.is_shared === 1,
    shareSlug: row.share_slug,
    updatedAt: row.updated_at,
  }
}

/**
 * D1-based dashboard storage implementation. Mirrors
 * `conversation-store/d1-store.ts`'s shape and guarantees.
 */
export class D1DashboardStore implements DashboardStore {
  private getDb(): D1Database {
    const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)

    if (!db) {
      throw new DashboardStoreError(
        'CHM_CLOUD_D1 binding not found. Ensure D1 database is configured in wrangler.toml',
        'STORAGE_ERROR'
      )
    }

    return db
  }

  async list(ownerId: string): Promise<StoredDashboard[]> {
    try {
      const db = this.getDb()

      const result = await db
        .prepare(
          `SELECT id, owner_id, name, layout_json, is_shared, share_slug, updated_at
           FROM dashboards
           WHERE owner_id = ?1
           ORDER BY name ASC`
        )
        .bind(ownerId)
        .all<D1DashboardRow>()

      return (result.results || []).map(rowToDashboard)
    } catch (error) {
      if (error instanceof DashboardStoreError) throw error
      throw new DashboardStoreError(
        `Failed to list dashboards: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  async get(ownerId: string, name: string): Promise<StoredDashboard | null> {
    try {
      const db = this.getDb()

      const row = await db
        .prepare(D1_GET_DASHBOARD_BY_NAME_SQL)
        .bind(ownerId, name)
        .first<D1DashboardRow>()

      return row ? rowToDashboard(row) : null
    } catch (error) {
      if (error instanceof DashboardStoreError) throw error
      throw new DashboardStoreError(
        `Failed to get dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  async upsert(dashboard: StoredDashboard): Promise<{ written: boolean }> {
    try {
      const db = this.getDb()

      const res = await db
        .prepare(D1_UPSERT_DASHBOARD_SQL)
        .bind(
          dashboard.id,
          dashboard.ownerId,
          dashboard.name,
          JSON.stringify(dashboard.charts),
          dashboard.isShared ? 1 : 0,
          dashboard.shareSlug,
          dashboard.updatedAt
        )
        .run()

      return { written: (res.meta?.changes ?? 0) > 0 }
    } catch (error) {
      throw new DashboardStoreError(
        `Failed to upsert dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  async saveByName(
    ownerId: string,
    name: string,
    charts: string[]
  ): Promise<StoredDashboard> {
    const existing = await this.get(ownerId, name)
    const now = Date.now()

    const dashboard: StoredDashboard = existing
      ? { ...existing, charts, updatedAt: now }
      : {
          id: crypto.randomUUID(),
          ownerId,
          name,
          charts,
          isShared: false,
          shareSlug: null,
          updatedAt: now,
        }

    const { written } = await this.upsert(dashboard)
    if (!written) {
      // Only reachable if the id (freshly minted or from an owner-scoped
      // read) somehow belongs to another owner — should never happen, but
      // fail loudly rather than silently return a record that wasn't saved.
      throw new DashboardStoreError(
        'Dashboard save was blocked (id ownership mismatch).',
        'STORAGE_ERROR'
      )
    }

    return dashboard
  }

  async delete(ownerId: string, name: string): Promise<void> {
    try {
      const db = this.getDb()

      await db
        .prepare(`DELETE FROM dashboards WHERE owner_id = ?1 AND name = ?2`)
        .bind(ownerId, name)
        .run()
    } catch (error) {
      throw new DashboardStoreError(
        `Failed to delete dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }

  async setSharing(
    ownerId: string,
    name: string,
    shared: boolean
  ): Promise<StoredDashboard | null> {
    const existing = await this.get(ownerId, name)
    if (!existing) return null

    // Enabling is idempotent — an already-shared dashboard keeps its slug.
    if (shared && existing.isShared && existing.shareSlug) {
      return existing
    }

    const updated: StoredDashboard = {
      ...existing,
      isShared: shared,
      // Revoking clears the slug in the same write as isShared=false, so a
      // revoked link can never resurface. Enabling mints a fresh
      // high-entropy slug — never derived from id/name.
      shareSlug: shared ? crypto.randomUUID() : null,
      updatedAt: Date.now(),
    }

    const { written } = await this.upsert(updated)
    if (!written) {
      throw new DashboardStoreError(
        'Dashboard sharing update was blocked (id ownership mismatch).',
        'STORAGE_ERROR'
      )
    }

    return updated
  }

  async getByShareSlug(slug: string): Promise<PublicSharedDashboard | null> {
    try {
      const db = this.getDb()

      const row = await db
        .prepare(D1_GET_DASHBOARD_BY_SLUG_SQL)
        .bind(slug)
        .first<Pick<D1DashboardRow, 'name' | 'layout_json'>>()

      if (!row) return null

      let charts: string[]
      try {
        const parsed = JSON.parse(row.layout_json)
        charts = Array.isArray(parsed) ? (parsed as string[]) : []
      } catch {
        charts = []
      }

      return { name: row.name, charts }
    } catch (error) {
      if (error instanceof DashboardStoreError) throw error
      throw new DashboardStoreError(
        `Failed to get shared dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'STORAGE_ERROR',
        error
      )
    }
  }
}
