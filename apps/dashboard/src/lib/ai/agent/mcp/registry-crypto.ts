/**
 * Server-side AES-256-GCM encryption for external MCP server auth secrets
 * (bearer tokens / custom-header values) stored in the D1 registration store.
 *
 * Mirrors the user-connection secret convention in
 * `lib/connection-store/crypto.ts` (same VERSION byte + IV + ciphertext layout,
 * same key material and priority) so operators never provision a second secret.
 * The only difference is the plaintext here is a single opaque string rather
 * than a structured credential object, and the key-derivation string is
 * domain-separated (`chm:mcp-registry:v1:`) so the two features never share a
 * derived key.
 *
 * A registered server's token is NEVER written to D1 in plaintext and NEVER
 * returned to the client — the registry API projects non-secret columns only.
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const VERSION = 1

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]
  }
  return undefined
}

// AES-256 key material, in priority order (identical to user-connections):
//   1. CHM_USER_CONNECTIONS_ENCRYPTION_KEY — optional dedicated key (32 bytes,
//      base64). Reused so both at-rest features share one operator-provided key.
//   2. Derived from CLERK_SECRET_KEY via SHA-256. Per-user MCP registration is a
//      cloud feature that already requires Clerk (D1 + signed-in scope), so the
//      Clerk secret is present whenever this runs — no separate secret needed.
async function deriveEncryptionKey(): Promise<CryptoKey | null> {
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
    new TextEncoder().encode(`chm:mcp-registry:v1:${clerkSecret}`)
  )
  return crypto.subtle.importKey('raw', digest, { name: ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * True when a key is available to encrypt/decrypt MCP auth secrets — i.e. a
 * dedicated key is set OR Clerk auth is configured. When false, callers must
 * refuse to persist a secret (never store plaintext) rather than silently
 * downgrading.
 */
export function isRegistryEncryptionConfigured(): boolean {
  return Boolean(
    readEnv('CHM_USER_CONNECTIONS_ENCRYPTION_KEY') ||
      readEnv('CLERK_SECRET_KEY')
  )
}

const KEY_UNAVAILABLE_ERROR =
  'MCP registry secret encryption unavailable: set CLERK_SECRET_KEY (or CHM_USER_CONNECTIONS_ENCRYPTION_KEY)'

export async function encryptRegistrySecret(secret: string): Promise<string> {
  const key = await deriveEncryptionKey()
  if (!key) throw new Error(KEY_UNAVAILABLE_ERROR)

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = new TextEncoder().encode(secret)
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

export async function decryptRegistrySecret(
  encrypted: string
): Promise<string> {
  const key = await deriveEncryptionKey()
  if (!key) throw new Error(KEY_UNAVAILABLE_ERROR)

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
