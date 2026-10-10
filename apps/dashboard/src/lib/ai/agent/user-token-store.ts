/**
 * Per-user model-provider tokens, encrypted at rest (D1 `user_provider_tokens`).
 *
 * Holds the AnyRouter token a signed-in user got from "Sign in with
 * AnyRouter", so the agent can use it from any device. Guests never reach this
 * store: their token lives only in their browser and travels per request.
 *
 * - AES-256-GCM with the same key material as user connections
 *   (`lib/connection-store/crypto.ts`: `CHM_USER_CONNECTIONS_ENCRYPTION_KEY`,
 *   else derived from `CLERK_SECRET_KEY`).
 * - Fail closed: no key or no `CHM_CLOUD_D1` binding → {@link UserTokenStoreError}
 *   with code `UNAVAILABLE`. Nothing is ever written in plaintext.
 * - The owner id and provider are bound into the GCM additional data, so a row
 *   copied to another owner fails to decrypt instead of leaking.
 * - An expired row reads as "not connected".
 * - Tokens are never logged and never returned by the status read.
 *
 * Schema: src/db/conversations-migrations/0033_user_provider_tokens.sql
 */

import { getPlatformBindings } from '@chm/platform'
import { deriveEncryptionKey } from '@/lib/connection-store/crypto'

export type UserTokenProvider = 'anyrouter'

export type UserTokenStoreErrorCode = 'UNAVAILABLE' | 'DECRYPT_FAILED'

export class UserTokenStoreError extends Error {
  readonly code: UserTokenStoreErrorCode

  constructor(message: string, code: UserTokenStoreErrorCode) {
    super(message)
    this.name = 'UserTokenStoreError'
    this.code = code
  }
}

export interface StoredUserToken {
  readonly token: string
  /** Epoch ms, or null when the provider gave no expiry. */
  readonly expiresAt: number | null
}

export interface UserTokenStatus {
  readonly connected: boolean
  readonly expiresAt: number | null
}

interface UserProviderTokenRow {
  ciphertext: string
  iv: string
  expires_at: number | null
}

const IV_LENGTH = 12

function getDb(): D1Database {
  const db = getPlatformBindings().getD1Database('CHM_CLOUD_D1')
  if (!db) {
    throw new UserTokenStoreError(
      'Token storage unavailable: CHM_CLOUD_D1 binding not found',
      'UNAVAILABLE'
    )
  }
  return db
}

async function getKey(): Promise<CryptoKey> {
  const key = await deriveEncryptionKey()
  if (!key) {
    throw new UserTokenStoreError(
      'Token encryption unavailable: set CLERK_SECRET_KEY (or CHM_USER_CONNECTIONS_ENCRYPTION_KEY)',
      'UNAVAILABLE'
    )
  }
  return key
}

function additionalData(
  ownerId: string,
  provider: string
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `chm:user-provider-token:v1:${ownerId}:${provider}`
  )
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}

function isExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && expiresAt <= now
}

/** Encrypt and upsert the user's token for `provider`. */
export async function saveUserProviderToken(
  ownerId: string,
  provider: UserTokenProvider,
  token: string,
  expiresAt: number | null,
  now: number = Date.now()
): Promise<void> {
  const db = getDb()
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(ownerId, provider) },
    key,
    new TextEncoder().encode(token)
  )

  await db
    .prepare(
      `INSERT INTO user_provider_tokens (owner_id, provider, ciphertext, iv, expires_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (owner_id, provider) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    )
    .bind(
      ownerId,
      provider,
      toBase64(new Uint8Array(ciphertext)),
      toBase64(iv),
      expiresAt,
      now
    )
    .run()
}

async function readRow(
  ownerId: string,
  provider: UserTokenProvider
): Promise<UserProviderTokenRow | null> {
  return getDb()
    .prepare(
      `SELECT ciphertext, iv, expires_at FROM user_provider_tokens
       WHERE owner_id = ?1 AND provider = ?2`
    )
    .bind(ownerId, provider)
    .first<UserProviderTokenRow>()
}

/** Decrypted token, or null when none is stored or it has expired. */
export async function getUserProviderToken(
  ownerId: string,
  provider: UserTokenProvider,
  now: number = Date.now()
): Promise<StoredUserToken | null> {
  const row = await readRow(ownerId, provider)
  if (!row || isExpired(row.expires_at, now)) return null

  const key = await getKey()
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(row.iv),
        additionalData: additionalData(ownerId, provider),
      },
      key,
      fromBase64(row.ciphertext)
    )
  } catch {
    throw new UserTokenStoreError(
      'Stored provider token could not be decrypted',
      'DECRYPT_FAILED'
    )
  }

  return {
    token: new TextDecoder().decode(plaintext),
    expiresAt: row.expires_at,
  }
}

/** Connection status without decrypting (the token itself is never returned). */
export async function getUserProviderTokenStatus(
  ownerId: string,
  provider: UserTokenProvider,
  now: number = Date.now()
): Promise<UserTokenStatus> {
  const row = await readRow(ownerId, provider)
  if (!row || isExpired(row.expires_at, now)) {
    return { connected: false, expiresAt: null }
  }
  return { connected: true, expiresAt: row.expires_at }
}

/** Remove the user's stored token (sign-out / revoke). Idempotent. */
export async function deleteUserProviderToken(
  ownerId: string,
  provider: UserTokenProvider
): Promise<void> {
  await getDb()
    .prepare(
      `DELETE FROM user_provider_tokens WHERE owner_id = ?1 AND provider = ?2`
    )
    .bind(ownerId, provider)
    .run()
}
