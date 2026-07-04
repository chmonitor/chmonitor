/**
 * Server-side AES-256-GCM encryption for stored Slack bot tokens.
 *
 * A workspace bot token (`xoxb-…`) is a bearer credential that can post to the
 * customer's Slack, so it is encrypted at rest in D1 rather than stored raw.
 * Mirrors lib/connection-store/crypto.ts (which encrypts user ClickHouse
 * credentials): same AES-256-GCM envelope (version byte + IV + ciphertext,
 * base64), same "explicit key OR derive from an always-present secret" model.
 *
 * Key material, in priority order:
 *   1. SLACK_TOKEN_ENCRYPTION_KEY — optional dedicated 32-byte base64 key, if
 *      you want to rotate the data key independently of the signing secret.
 *   2. Derived (SHA-256) from SLACK_SIGNING_SECRET. The Slack app REQUIRES the
 *      signing secret to function (every inbound request is verified with it),
 *      so it is always present when a token is being stored — no extra secret to
 *      provision. Rotating the signing secret re-keys stored tokens, which means
 *      workspaces must reinstall; acceptable and loud (decrypt fails → treated as
 *      "not installed") rather than a silent security downgrade.
 *
 * Fail-closed: with no key material available, encryption/decryption throw, so
 * the OAuth callback refuses to persist a token rather than storing it in the
 * clear.
 */

import { getSlackSigningSecret, getSlackTokenEncryptionKey } from './config'

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const VERSION = 1

async function deriveEncryptionKey(): Promise<CryptoKey | null> {
  const explicit = getSlackTokenEncryptionKey()
  if (explicit) {
    const raw = Uint8Array.from(atob(explicit.trim()), (c) => c.charCodeAt(0))
    if (raw.length !== 32) {
      throw new Error(
        'SLACK_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64-encoded)'
      )
    }
    return crypto.subtle.importKey('raw', raw, { name: ALGORITHM }, false, [
      'encrypt',
      'decrypt',
    ])
  }

  const signingSecret = getSlackSigningSecret()
  if (!signingSecret) return null
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`chm:slack-token:v1:${signingSecret}`)
  )
  return crypto.subtle.importKey('raw', digest, { name: ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Whether token encryption is available (a dedicated key or the signing secret). */
export function isTokenEncryptionConfigured(): boolean {
  return Boolean(getSlackTokenEncryptionKey() || getSlackSigningSecret())
}

/** Encrypt a bot token to the versioned base64 envelope stored in D1. */
export async function encryptToken(token: string): Promise<string> {
  const key = await deriveEncryptionKey()
  if (!key) {
    throw new Error(
      'Slack token encryption unavailable: set SLACK_SIGNING_SECRET (or SLACK_TOKEN_ENCRYPTION_KEY)'
    )
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = new TextEncoder().encode(token)
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    plaintext
  )

  const payload = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength)
  payload[0] = VERSION
  payload.set(iv, 1)
  payload.set(new Uint8Array(ciphertext), 1 + IV_LENGTH)

  return btoa(String.fromCharCode(...payload))
}

/** Decrypt a stored base64 envelope back to the raw bot token. */
export async function decryptToken(encrypted: string): Promise<string> {
  const key = await deriveEncryptionKey()
  if (!key) {
    throw new Error(
      'Slack token encryption unavailable: set SLACK_SIGNING_SECRET (or SLACK_TOKEN_ENCRYPTION_KEY)'
    )
  }
  const payload = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))

  if (payload[0] !== VERSION) {
    throw new Error('Unsupported encryption version')
  }

  const iv = payload.slice(1, 1 + IV_LENGTH)
  const ciphertext = payload.slice(1 + IV_LENGTH)

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  )

  return new TextDecoder().decode(plaintext)
}
