/**
 * D1-backed store for per-user external MCP server registrations (plan 43).
 *
 * Isolation: EVERY read and write is scoped `WHERE user_id = ?` — one user's
 * servers and credentials are never visible to another. The owner-guarded
 * upsert (mirroring `conversation-store/d1-store.ts` and plan 04) refuses to
 * reassign a row owned by a different user.
 *
 * Secret hygiene: `auth_secret` is stored ENCRYPTED at rest (see
 * `registry-crypto.ts`). The metadata projections (`listForUser` / `get`) NEVER
 * include the secret — only `authKind` / `authHeaderName` / `hasSecret`. The
 * plaintext token is decrypted in exactly one place — `listEnabledConnectInputs`
 * — which runs server-side to build outbound auth headers and is never returned
 * to a client.
 *
 * Best-effort like the other insights/cloud D1 stores: a missing `CHM_CLOUD_D1`
 * binding (the OSS/self-hosted default) resolves to empty/`false` rather than
 * throwing, so a deployment with no D1 simply has no registered servers and the
 * agent runs with built-ins only. The table is created lazily on first use so
 * persistence works even before the checked-in migration
 * (`db/conversations-migrations/0015_mcp_server_registrations.sql`) is applied.
 */

import {
  decryptRegistrySecret,
  encryptRegistrySecret,
  isRegistryEncryptionConfigured,
} from './registry-crypto'
import { getPlatformBindings } from '@chm/platform'

export type McpTransport = 'http' | 'sse'
export type McpAuthKind = 'none' | 'bearer' | 'header'

/** Structured auth for an MCP registration (decrypted form). */
export type McpAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'header'; headerName: string; value: string }

/** Safe registration metadata — NEVER carries the decrypted secret. */
export interface McpRegistration {
  id: string
  userId: string
  name: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  authHeaderName: string | null
  /** True when a secret is stored, so the UI can render state without it. */
  hasSecret: boolean
  enabled: boolean
  /** Parsed cached tool names from the last successful validate (or null). */
  capabilities: string[] | null
  lastValidatedAt: number | null
  createdAt: number
  updatedAt: number
}

/** Input for {@link McpRegistrationStore.upsert} (create / full replace). */
export interface McpRegistrationUpsert {
  id: string
  userId: string
  name: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  /** Plaintext secret; encrypted before write. Omit/undefined for `none`. */
  authSecret?: string | null
  authHeaderName?: string | null
  enabled: boolean
  /** Cached tool names from a successful validate. */
  capabilities?: string[] | null
  lastValidatedAt?: number | null
}

/** Decrypted connect input consumed by the agent loader. */
export interface McpConnectInput {
  id: string
  name: string
  url: string
  transport: McpTransport
  auth: McpAuth
}

const TABLE = 'mcp_server_registrations'

// Kept in sync with db/conversations-migrations/0015_mcp_server_registrations.sql
// — identical columns / types / defaults (that file adds explanatory column
// comments). `IF NOT EXISTS` makes the tracked migration and this lazy DDL
// idempotent together.
const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  url                TEXT NOT NULL,
  transport          TEXT NOT NULL DEFAULT 'http',
  auth_kind          TEXT NOT NULL DEFAULT 'none',
  auth_secret        TEXT,
  auth_header_name   TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  capabilities_json  TEXT,
  last_validated_at  INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
)`

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_${TABLE}_user_id ON ${TABLE} (user_id)`

/**
 * Owner-guarded upsert. `ON CONFLICT (id) DO UPDATE ... WHERE user_id =
 * excluded.user_id` leaves a row owned by a different user untouched (0
 * `changes`) instead of reassigning it — the per-user isolation control.
 * Exported so a `bun:sqlite` test can prove the guard without re-deriving it.
 */
export const D1_UPSERT_MCP_REGISTRATION_SQL = `INSERT INTO ${TABLE}
   (id, user_id, name, url, transport, auth_kind, auth_secret, auth_header_name, enabled, capabilities_json, last_validated_at, created_at, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
   ON CONFLICT (id) DO UPDATE SET
     name = excluded.name,
     url = excluded.url,
     transport = excluded.transport,
     auth_kind = excluded.auth_kind,
     auth_secret = excluded.auth_secret,
     auth_header_name = excluded.auth_header_name,
     enabled = excluded.enabled,
     capabilities_json = excluded.capabilities_json,
     last_validated_at = excluded.last_validated_at,
     updated_at = excluded.updated_at
   WHERE ${TABLE}.user_id = excluded.user_id`

interface D1McpRegistrationRow {
  id: string
  user_id: string
  name: string
  url: string
  transport: string
  auth_kind: string
  auth_secret: string | null
  auth_header_name: string | null
  enabled: number
  capabilities_json: string | null
  last_validated_at: number | null
  created_at: number
  updated_at: number
}

function normalizeTransport(value: string): McpTransport {
  return value === 'sse' ? 'sse' : 'http'
}

function normalizeAuthKind(value: string): McpAuthKind {
  return value === 'bearer' || value === 'header' ? value : 'none'
}

function parseCapabilities(json: string | null): string[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string')
      : null
  } catch {
    return null
  }
}

function rowToMeta(row: D1McpRegistrationRow): McpRegistration {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    transport: normalizeTransport(row.transport),
    authKind: normalizeAuthKind(row.auth_kind),
    authHeaderName: row.auth_header_name,
    hasSecret: Boolean(row.auth_secret),
    enabled: row.enabled === 1,
    capabilities: parseCapabilities(row.capabilities_json),
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getDb(): D1Database | null {
  try {
    return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
  } catch {
    return null
  }
}

// Single-flight lazy migration: concurrent first calls share one promise so the
// idempotent DDL runs at most once per process; a failure clears it to retry.
let migration: Promise<void> | null = null

async function ensureMigrated(db: D1Database): Promise<void> {
  if (!migration) {
    migration = (async () => {
      await db.prepare(MIGRATION_SQL).run()
      await db.prepare(INDEX_SQL).run()
    })().catch((error) => {
      migration = null
      throw error
    })
  }
  return migration
}

/**
 * True when per-user MCP registration persistence is usable on this deployment
 * (a D1 binding is present). OSS/self-hosted without D1 returns false and the
 * registry API reports "not enabled" rather than crashing.
 */
export function isMcpRegistryEnabled(): boolean {
  return getDb() !== null
}

export class McpRegistrationStore {
  private requireDb(): D1Database {
    const db = getDb()
    if (!db) {
      throw new McpRegistryError(
        'MCP registration storage is not enabled (no CHM_CLOUD_D1 binding).',
        'NOT_ENABLED'
      )
    }
    return db
  }

  /** List a user's registrations (metadata only — no secrets). */
  async listForUser(userId: string): Promise<McpRegistration[]> {
    const db = this.requireDb()
    await ensureMigrated(db)
    const result = await db
      .prepare(
        `SELECT id, user_id, name, url, transport, auth_kind, auth_secret, auth_header_name, enabled, capabilities_json, last_validated_at, created_at, updated_at
         FROM ${TABLE} WHERE user_id = ?1 ORDER BY created_at ASC`
      )
      .bind(userId)
      .all<D1McpRegistrationRow>()
    return (result.results ?? []).map(rowToMeta)
  }

  /** Get one registration by id, scoped to the user (metadata only). */
  async get(userId: string, id: string): Promise<McpRegistration | null> {
    const db = this.requireDb()
    await ensureMigrated(db)
    const row = await db
      .prepare(
        `SELECT id, user_id, name, url, transport, auth_kind, auth_secret, auth_header_name, enabled, capabilities_json, last_validated_at, created_at, updated_at
         FROM ${TABLE} WHERE user_id = ?1 AND id = ?2`
      )
      .bind(userId, id)
      .first<D1McpRegistrationRow>()
    return row ? rowToMeta(row) : null
  }

  /**
   * Create or fully replace a registration (owner-guarded). Encrypts the secret
   * before write. Returns `written: false` when the id belongs to another user
   * and the write was blocked by the ownership guard.
   */
  async upsert(input: McpRegistrationUpsert): Promise<{ written: boolean }> {
    const db = this.requireDb()
    await ensureMigrated(db)

    let encryptedSecret: string | null = null
    if (input.authKind !== 'none' && input.authSecret) {
      if (!isRegistryEncryptionConfigured()) {
        throw new McpRegistryError(
          'Cannot store an MCP auth secret without encryption configured.',
          'ENCRYPTION_UNAVAILABLE'
        )
      }
      encryptedSecret = await encryptRegistrySecret(input.authSecret)
    }

    const now = Date.now()
    const capabilitiesJson =
      input.capabilities != null ? JSON.stringify(input.capabilities) : null

    const res = await db
      .prepare(D1_UPSERT_MCP_REGISTRATION_SQL)
      .bind(
        input.id,
        input.userId,
        input.name,
        input.url,
        input.transport,
        input.authKind,
        encryptedSecret,
        input.authHeaderName ?? null,
        input.enabled ? 1 : 0,
        capabilitiesJson,
        input.lastValidatedAt ?? null,
        now,
        now
      )
      .run()

    return { written: (res.meta?.changes ?? 0) > 0 }
  }

  /**
   * Targeted patch of name/enabled, scoped to the user. Never touches the
   * secret or URL, so enable/disable/rename can't accidentally clear a token.
   */
  async patch(
    userId: string,
    id: string,
    fields: { name?: string; enabled?: boolean }
  ): Promise<{ updated: boolean }> {
    const db = this.requireDb()
    await ensureMigrated(db)

    const existing = await this.get(userId, id)
    if (!existing) return { updated: false }

    const name = fields.name ?? existing.name
    const enabled = fields.enabled ?? existing.enabled
    const res = await db
      .prepare(
        `UPDATE ${TABLE} SET name = ?1, enabled = ?2, updated_at = ?3 WHERE user_id = ?4 AND id = ?5`
      )
      .bind(name, enabled ? 1 : 0, Date.now(), userId, id)
      .run()
    return { updated: (res.meta?.changes ?? 0) > 0 }
  }

  /** Cache the tool list from a successful validate (scoped to the user). */
  async recordValidation(
    userId: string,
    id: string,
    capabilities: string[]
  ): Promise<void> {
    const db = this.requireDb()
    await ensureMigrated(db)
    await db
      .prepare(
        `UPDATE ${TABLE} SET capabilities_json = ?1, last_validated_at = ?2, updated_at = ?2 WHERE user_id = ?3 AND id = ?4`
      )
      .bind(JSON.stringify(capabilities), Date.now(), userId, id)
      .run()
  }

  /** Remove a registration, scoped to the user. */
  async remove(userId: string, id: string): Promise<{ deleted: boolean }> {
    const db = this.requireDb()
    await ensureMigrated(db)
    const res = await db
      .prepare(`DELETE FROM ${TABLE} WHERE user_id = ?1 AND id = ?2`)
      .bind(userId, id)
      .run()
    return { deleted: (res.meta?.changes ?? 0) > 0 }
  }

  /**
   * Resolve a user's ENABLED registrations into decrypted connect inputs for
   * the agent loader. This is the only path that decrypts secrets; the result
   * is used solely to open outbound MCP clients server-side and is never
   * returned to a client. A row whose secret fails to decrypt is skipped
   * (logged) rather than aborting the whole load.
   */
  async listEnabledConnectInputs(userId: string): Promise<McpConnectInput[]> {
    const db = this.requireDb()
    await ensureMigrated(db)
    const result = await db
      .prepare(
        `SELECT id, user_id, name, url, transport, auth_kind, auth_secret, auth_header_name, enabled, capabilities_json, last_validated_at, created_at, updated_at
         FROM ${TABLE} WHERE user_id = ?1 AND enabled = 1 ORDER BY created_at ASC`
      )
      .bind(userId)
      .all<D1McpRegistrationRow>()

    const inputs: McpConnectInput[] = []
    for (const row of result.results ?? []) {
      try {
        inputs.push({
          id: row.id,
          name: row.name,
          url: row.url,
          transport: normalizeTransport(row.transport),
          auth: await toAuth(row),
        })
      } catch (error) {
        console.error(
          `[mcp-registry] Skipping registration ${row.id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    return inputs
  }
}

async function toAuth(row: D1McpRegistrationRow): Promise<McpAuth> {
  const kind = normalizeAuthKind(row.auth_kind)
  if (kind === 'none' || !row.auth_secret) return { kind: 'none' }
  const secret = await decryptRegistrySecret(row.auth_secret)
  if (kind === 'bearer') return { kind: 'bearer', token: secret }
  return {
    kind: 'header',
    headerName: row.auth_header_name || 'Authorization',
    value: secret,
  }
}

export type McpRegistryErrorCode =
  | 'NOT_ENABLED'
  | 'NOT_FOUND'
  | 'ENCRYPTION_UNAVAILABLE'
  | 'VALIDATION'

export class McpRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: McpRegistryErrorCode,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'McpRegistryError'
  }
}

/** Shared singleton — the store is stateless beyond the D1 binding lookup. */
export const mcpRegistrationStore = new McpRegistrationStore()
