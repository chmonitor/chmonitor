/**
 * D1-backed store for Slack workspace installations (plans/37).
 *
 * Reuses the same `CHM_CLOUD_D1` binding as the agent conversation store and
 * the alert-history / github-deployments stores; the `slack_installations`
 * table is created by the 0015 migration. The bot token is encrypted at rest
 * (lib/slack/token-crypto.ts) — the plaintext token only ever exists in memory
 * during a request.
 *
 * Best-effort like the sibling stores: a missing binding (the OSS default with
 * no D1) or any D1 error is caught, logged, and resolved to false/null rather
 * than thrown — so the dashboard never crashes over a Slack-store failure.
 * `upsertInstallation` returns a boolean so the OAuth callback can tell the
 * user when persistence genuinely failed (a stored-token-less install is
 * useless), rather than silently claiming success.
 */

import { decryptToken, encryptToken } from './token-crypto'
import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[slack-install-store] ${msg}`, {
    component: 'slack-install-store',
  })

const TABLE = 'slack_installations'

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/** What we persist about an installed workspace (token in plaintext in memory). */
export interface SlackInstallation {
  teamId: string
  teamName?: string | null
  /** Raw `xoxb-` bot token — encrypted before it touches D1. */
  botToken: string
  botUserId?: string | null
  scope?: string | null
  authedUserId?: string | null
  ownerRef: string
  installedAt: number
  updatedAt: number
}

interface D1InstallRow {
  team_id: string
  team_name: string | null
  bot_token_enc: string
  bot_user_id: string | null
  scope: string | null
  authed_user_id: string | null
  owner_ref: string
  installed_at: number
  updated_at: number
}

/**
 * Persist (or update) a workspace installation, keyed by `team_id` so a
 * reinstall updates in place. Encrypts the bot token first. Returns false on
 * any failure (missing D1, encryption misconfig, D1 error) — never throws.
 */
export async function upsertInstallation(
  install: SlackInstallation
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) {
      warn('no CHM_CLOUD_D1 binding — cannot persist Slack installation')
      return false
    }

    const botTokenEnc = await encryptToken(install.botToken)

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (team_id, team_name, bot_token_enc, bot_user_id, scope, authed_user_id, owner_ref, installed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (team_id) DO UPDATE SET
           team_name = excluded.team_name,
           bot_token_enc = excluded.bot_token_enc,
           bot_user_id = excluded.bot_user_id,
           scope = excluded.scope,
           authed_user_id = excluded.authed_user_id,
           owner_ref = excluded.owner_ref,
           updated_at = excluded.updated_at`
      )
      .bind(
        install.teamId,
        install.teamName ?? null,
        botTokenEnc,
        install.botUserId ?? null,
        install.scope ?? null,
        install.authedUserId ?? null,
        install.ownerRef,
        install.installedAt,
        install.updatedAt
      )
      .run()
    return true
  } catch (err) {
    warn(`failed to upsert installation ${install.teamId}: ${err}`)
    return false
  }
}

async function rowToInstall(
  row: D1InstallRow
): Promise<SlackInstallation | null> {
  try {
    const botToken = await decryptToken(row.bot_token_enc)
    return {
      teamId: row.team_id,
      teamName: row.team_name,
      botToken,
      botUserId: row.bot_user_id,
      scope: row.scope,
      authedUserId: row.authed_user_id,
      ownerRef: row.owner_ref,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    }
  } catch (err) {
    // A decrypt failure (e.g. the signing secret was rotated) means the stored
    // token is no longer usable — treat the workspace as not-installed rather
    // than surfacing ciphertext or crashing. Reinstall re-keys it.
    warn(`failed to decrypt token for ${row.team_id}: ${err}`)
    return null
  }
}

/** Fetch an installation by workspace id, with the decrypted token, or null. */
export async function getInstallation(
  teamId: string
): Promise<SlackInstallation | null> {
  try {
    const db = getDb()
    if (!db) return null
    const row = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE team_id = ?1`)
      .bind(teamId)
      .first<D1InstallRow>()
    if (!row) return null
    return rowToInstall(row)
  } catch (err) {
    warn(`failed to get installation ${teamId}: ${err}`)
    return null
  }
}

/** Remove an installation (e.g. on app uninstall). Returns false on failure. */
export async function deleteInstallation(teamId: string): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    await db
      .prepare(`DELETE FROM ${TABLE} WHERE team_id = ?1`)
      .bind(teamId)
      .run()
    return true
  } catch (err) {
    warn(`failed to delete installation ${teamId}: ${err}`)
    return false
  }
}
