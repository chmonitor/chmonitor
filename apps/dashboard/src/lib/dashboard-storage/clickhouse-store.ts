/**
 * ClickHouse-backed dashboard storage (server-only, self-hosted OSS).
 *
 * Persists saved dashboards in the operator's own ClickHouse via
 * `CHM_STATE_CLICKHOUSE_*` (see `lib/state-backend/config.ts`). Resolved by
 * `resolve-server-store.ts` after D1 and before Postgres.
 *
 * Storage model: `${prefix}dashboards` on `ReplacingMergeTree(updated_at)`
 * keyed `(owner_id, name)` — a save is a plain insert with a newer
 * `updated_at`; reads use `FINAL`; deletes are lightweight `DELETE FROM`.
 * `share_slug` uses an empty string for "no slug" (ClickHouse non-Nullable
 * column keeps the sorting key simple); the row mapper converts it to null.
 */

import type { StateClickHouseConfig } from '@/lib/state-backend/config'
import type { DashboardLayout } from '@/types/dashboard-layout'
import type {
  DashboardStore,
  PublicSharedDashboard,
  StoredDashboard,
} from './types'

import { DashboardStoreError } from './types'
import {
  StateClickHouseClient,
  type StateClickHouseExecutor,
} from '@/lib/state-backend/clickhouse-client'
import { normalizeLayout } from '@/types/dashboard-layout'

interface ClickHouseDashboardRow {
  id: string
  owner_id: string
  name: string
  layout_json: string
  is_shared: number
  share_slug: string
  updated_at: number
}

/** Exported for SQL-generation tests. */
export function buildDashboardsDdl(database: string, prefix: string): string {
  return `CREATE TABLE IF NOT EXISTS ${database}.${prefix}dashboards (
  id String,
  owner_id String,
  name String,
  layout_json String,
  is_shared UInt8,
  share_slug String,
  updated_at Int64
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (owner_id, name)`
}

const COLUMNS =
  'id, owner_id, name, layout_json, is_shared, share_slug, updated_at'

function parseLayoutJson(layoutJson: string): DashboardLayout {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(layoutJson)
  } catch {
    parsed = null
  }
  return normalizeLayout(parsed)
}

function rowToDashboard(row: ClickHouseDashboardRow): StoredDashboard {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    layout: parseLayoutJson(row.layout_json),
    isShared: Number(row.is_shared) === 1,
    shareSlug: row.share_slug === '' ? null : row.share_slug,
    updatedAt: Number(row.updated_at),
  }
}

export class ClickHouseDashboardStore implements DashboardStore {
  private readonly client: StateClickHouseExecutor
  private readonly table: string
  private readonly database: string
  private readonly prefix: string
  private initialized = false

  constructor(config: StateClickHouseConfig, client?: StateClickHouseExecutor) {
    this.client = client ?? new StateClickHouseClient(config)
    this.database = config.database
    this.prefix = config.tablePrefix
    this.table = `${config.database}.${config.tablePrefix}dashboards`
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    await this.client.command(`CREATE DATABASE IF NOT EXISTS ${this.database}`)
    await this.client.command(buildDashboardsDdl(this.database, this.prefix))
    this.initialized = true
  }

  async list(ownerId: string): Promise<StoredDashboard[]> {
    await this.ensureInitialized()
    const rows = await this.client.query<ClickHouseDashboardRow>(
      `SELECT ${COLUMNS} FROM ${this.table} FINAL
       WHERE owner_id = {owner_id:String} ORDER BY name ASC`,
      { owner_id: ownerId }
    )
    return rows.map(rowToDashboard)
  }

  async get(ownerId: string, name: string): Promise<StoredDashboard | null> {
    await this.ensureInitialized()
    const rows = await this.client.query<ClickHouseDashboardRow>(
      `SELECT ${COLUMNS} FROM ${this.table} FINAL
       WHERE owner_id = {owner_id:String} AND name = {name:String} LIMIT 1`,
      { owner_id: ownerId, name }
    )
    const row = rows[0]
    return row ? rowToDashboard(row) : null
  }

  async upsert(dashboard: StoredDashboard): Promise<{ written: boolean }> {
    await this.ensureInitialized()
    // ReplacingMergeTree keyed (owner_id, name): the insert replaces only the
    // caller's own row for that name — a different owner's row is a different
    // key, so cross-owner reassignment is structurally impossible and the D1
    // ownership guard has nothing to defend against here.
    await this.client.command(
      `INSERT INTO ${this.table} (${COLUMNS}) VALUES
        ({id:String}, {owner_id:String}, {name:String}, {layout_json:String},
         {is_shared:UInt8}, {share_slug:String}, {updated_at:Int64})`,
      {
        id: dashboard.id,
        owner_id: dashboard.ownerId,
        name: dashboard.name,
        layout_json: JSON.stringify(dashboard.layout),
        is_shared: dashboard.isShared ? 1 : 0,
        share_slug: dashboard.shareSlug ?? '',
        updated_at: dashboard.updatedAt,
      }
    )
    return { written: true }
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

    await this.upsert(dashboard)
    return dashboard
  }

  async delete(ownerId: string, name: string): Promise<void> {
    await this.ensureInitialized()
    try {
      await this.client.command(
        `DELETE FROM ${this.table} WHERE owner_id = {owner_id:String} AND name = {name:String}`,
        { owner_id: ownerId, name }
      )
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

    if (shared && existing.isShared && existing.shareSlug) {
      return existing
    }

    const updated: StoredDashboard = {
      ...existing,
      isShared: shared,
      shareSlug: shared ? crypto.randomUUID() : null,
      updatedAt: Date.now(),
    }

    await this.upsert(updated)
    return updated
  }

  async getByShareSlug(slug: string): Promise<PublicSharedDashboard | null> {
    await this.ensureInitialized()
    // Guard: the empty string means "no slug" in storage — never let it match.
    if (!slug) return null
    const rows = await this.client.query<
      Pick<ClickHouseDashboardRow, 'name' | 'layout_json'>
    >(
      `SELECT name, layout_json FROM ${this.table} FINAL
       WHERE share_slug = {slug:String} AND is_shared = 1 LIMIT 1`,
      { slug }
    )
    const row = rows[0]
    if (!row) return null
    return { name: row.name, layout: parseLayoutJson(row.layout_json) }
  }
}
