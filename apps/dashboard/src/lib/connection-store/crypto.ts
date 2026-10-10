/**
 * Server-side AES-256-GCM encryption for user connection credentials.
 */

import type { ConnectionCredentials } from './types'

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const VERSION = 1

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]
  }
  return undefined
}

// AES-256 key material, in priority order:
//   1. CHM_USER_CONNECTIONS_ENCRYPTION_KEY — optional dedicated key (32 bytes,
//      base64). Set this only if you want the data key independent of the auth
//      secret (e.g. to rotate it separately).
//   2. Derived from CLERK_SECRET_KEY via SHA-256. The user-connections feature
//      already REQUIRES Clerk auth (see server-feature.ts), so the Clerk secret
//      is always present when this runs — no separate secret to provision. This
//      keeps config simple; the trade-off is that rotating CLERK_SECRET_KEY
//      re-keys stored connections (acceptable: it invalidates sessions anyway).
export async function deriveEncryptionKey(): Promise<CryptoKey | null> {
  const explicit = readEnv('CHM_USER_CONNECTIONS_ENCRYPTION_KEY')
  if (explicit) {
    const raw = Uint8Array.from(atob(explicit.trim()), (c) => c.charCodeAt(0))
    if (raw.length !== 32) {
      throw new Error(
        'CHM_USER_CONNECTIONS_ENCRYPTION_KEY must be 32 bytes (base64-encoded)'
      )
    }
    return crypto.subtle.importKey('raw', raw, { name: ALGORITHM }, false, [
      'encrypt',
      'decrypt',
    ])
  }

  const clerkSecret = readEnv('CLERK_SECRET_KEY')
  if (!clerkSecret) return null
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`chm:user-connections:v1:${clerkSecret}`)
  )
  return crypto.subtle.importKey('raw', digest, { name: ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encryption is available whenever a dedicated key is set OR Clerk auth is
 * configured (the derivation source). Per-user connection storage requires Clerk
 * anyway, so this is effectively always true when the feature is usable.
 */
export function isEncryptionConfigured(): boolean {
  return Boolean(
    readEnv('CHM_USER_CONNECTIONS_ENCRYPTION_KEY') ||
      readEnv('CLERK_SECRET_KEY')
  )
}

export async function encryptCredentials(
  credentials: ConnectionCredentials
): Promise<string> {
  const key = await deriveEncryptionKey()
  if (!key) {
    throw new Error(
      'User-connections encryption unavailable: set CLERK_SECRET_KEY (or CHM_USER_CONNECTIONS_ENCRYPTION_KEY)'
    )
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials))
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

export async function decryptCredentials(
  encrypted: string
): Promise<ConnectionCredentials> {
  const key = await deriveEncryptionKey()
  if (!key) {
    throw new Error(
      'User-connections encryption unavailable: set CLERK_SECRET_KEY (or CHM_USER_CONNECTIONS_ENCRYPTION_KEY)'
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

  return JSON.parse(
    new TextDecoder().decode(plaintext)
  ) as ConnectionCredentials
}
