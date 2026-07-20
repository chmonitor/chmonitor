/**
 * Postgres-backed dashboard storage (server-only, self-hosted OSS).
 *
 * Mirrors `d1-store.ts`'s interface and ownership guarantees, following the
 * client-creation / lazy-migration pattern of
 * `connection-store/postgres-store.ts`. Resolved by
 * `resolve-server-store.ts` when no D1 binding is present and
 * `DATABASE_URL` / `POSTGRES_URL` is set.
 *
 * Node-only: imports the `postgres` package. Reached only via dynamic import
 * so it never enters the Cloudflare Workers bundle.
 */

import type { DashboardLayout } from '@/types/dashboard-layout'
import type {
  DashboardStore,
  PublicSharedDashboard,
  StoredDashboard,
} from './types'

import { DashboardStoreError } from './types'
import postgres from 'postgres'
import { normalizeLayout } from '@/types/dashboard-layout'

interface PostgresDashboardRow {
  id: string
  owner_id: string
  name: string
  layout_json: string
  is_shared: boolean
  share_slug: string | null
  updated_at: string | number
}

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  share_slug TEXT,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboards_owner_id ON dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_share_slug ON dashboards(share_slug);
`

function parseLayoutJson(layoutJson: string): DashboardLayout {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(layoutJson)
  } catch {
    parsed = null
  }
  return normalizeLayout(parsed)
}

function rowToDashboard(row: PostgresDashboardRow): StoredDashboard {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    layout: parseLayoutJson(row.layout_json),
    isShared: row.is_shared === true,
    shareSlug: row.share_slug,
    updatedAt: Number(row.updated_at),
  }
}

export class PostgresDashboardStore implements DashboardStore {
  private sql: ReturnType<typeof postgres>
  private initialized = false

  constructor(connectionString?: string) {
    const url =
      connectionString ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL

    if (!url) {
      throw new DashboardStoreError(
        'DATABASE_URL is required for Postgres dashboard storage',
        'STORAGE_ERROR'
      )
    }

    this.sql = postgres(url, { max: 5 })
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.sql.unsafe(MIGRATION_SQL)
    this.initialized = true
  }

  async list(ownerId: string): Promise<StoredDashboard[]> {
    await this.ensureInitialized()
    const rows = await this.sql<PostgresDashboardRow[]>`
      SELECT id, owner_id, name, layout_json, is_shared, share_slug, updated_at
      FROM dashboards WHERE owner_id = ${ownerId} ORDER BY name ASC
    `
    return rows.map(rowToDashboard)
  }

  async get(ownerId: string, name: string): Promise<StoredDashboard | null> {
    await this.ensureInitialized()
    const rows = await this.sql<PostgresDashboardRow[]>`
      SELECT id, owner_id, name, layout_json, is_shared, share_slug, updated_at
      FROM dashboards WHERE owner_id = ${ownerId} AND name = ${name} LIMIT 1
    `
    const row = rows[0]
    return row ? rowToDashboard(row) : null
  }

  async upsert(dashboard: StoredDashboard): Promise<{ written: boolean }> {
    await this.ensureInitialized()
    // Same ownership guard as D1_UPSERT_DASHBOARD_SQL: an id conflict with a
    // row owned by a different owner writes nothing rather than reassigning.
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO dashboards (id, owner_id, name, layout_json, is_shared, share_slug, updated_at)
      VALUES (${dashboard.id}, ${dashboard.ownerId}, ${dashboard.name},
              ${JSON.stringify(dashboard.layout)}, ${dashboard.isShared},
              ${dashboard.shareSlug}, ${dashboard.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        layout_json = excluded.layout_json,
        is_shared = excluded.is_shared,
        share_slug = excluded.share_slug,
        updated_at = excluded.updated_at
      WHERE dashboards.owner_id = excluded.owner_id
      RETURNING id
    `
    return { written: rows.length > 0 }
  }

  async saveByName(
    ownerId: string,
    name: string,
    layout: DashboardLayout
  ): Promise<StoredDashboard> {
    const existing = await this.get(ownerId, name)
    const now = Date.now()

    const dashboard: StoredDashboard = existing
      ? { ...existing, layout, updatedAt: now }
      : {
          id: crypto.randomUUID(),
          ownerId,
          name,
          layout,
          isShared: false,
          shareSlug: null,
          updatedAt: now,
        }

    const { written } = await this.upsert(dashboard)
    if (!written) {
      throw new DashboardStoreError(
        'Dashboard save was blocked (id ownership mismatch).',
        'STORAGE_ERROR'
      )
    }
    return dashboard
  }

  async delete(ownerId: string, name: string): Promise<void> {
    await this.ensureInitialized()
    await this.sql`
      DELETE FROM dashboards WHERE owner_id = ${ownerId} AND name = ${name}
    `
  }

  async setSharing(
    ownerId: string,
    name: string,
    shared: boolean
  ): Promise<StoredDashboard | null> {
    const existing = await this.get(ownerId, name)
    if (!existing) return null

    if (shared && existing.isShared && existing.shareSlug) {
      return existing
    }

    const updated: StoredDashboard = {
      ...existing,
      isShared: shared,
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
    await this.ensureInitialized()
    const rows = await this.sql<
      Pick<PostgresDashboardRow, 'name' | 'layout_json'>[]
    >`
      SELECT name, layout_json FROM dashboards
      WHERE share_slug = ${slug} AND is_shared = TRUE LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    return { name: row.name, layout: parseLayoutJson(row.layout_json) }
  }
}
