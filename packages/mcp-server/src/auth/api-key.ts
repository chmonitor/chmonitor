export const ALL_API_KEY_SCOPES = [
  'read:metrics',
  'read:insights',
  'agent:run',
  'mcp:access',
] as const

export type ApiKeyScope = (typeof ALL_API_KEY_SCOPES)[number]

interface Payload {
  sub: string
  exp: number
  iat: number
  /** Optional scopes; missing/empty means all scopes (back-compat). */
  scopes?: string[]
}

function getSecret(): string | null {
  return process.env.CHM_API_KEY_SECRET ?? null
}

function bytesToB64url(input: Uint8Array): string {
  const binary = String.fromCharCode(...input)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function textToB64url(input: string): string {
  return bytesToB64url(new TextEncoder().encode(input))
}

function unb64url(input: string): Uint8Array | null {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

async function sign(payloadEnc: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadEnc)
  )
  return new Uint8Array(signature)
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index]
  }

  return diff === 0
}

function normalizeScopes(scopes?: string[] | null): string[] | undefined {
  if (!scopes || scopes.length === 0) return undefined
  const allowed = new Set<string>(ALL_API_KEY_SCOPES)
  const filtered = [
    ...new Set(scopes.map((s) => s.trim()).filter(Boolean)),
  ].filter((s) => allowed.has(s))
  return filtered.length > 0 ? filtered : undefined
}

export async function issueApiKey(
  sub: string,
  days = 30,
  scopes?: string[]
): Promise<string> {
  const secret = getSecret()
  if (!secret) throw new Error('CHM_API_KEY_SECRET is not configured')

  const now = Math.floor(Date.now() / 1000)
  const payload: Payload = { sub, iat: now, exp: now + days * 86400 }
  const normalized = normalizeScopes(scopes)
  if (normalized) payload.scopes = normalized
  const payloadEnc = textToB64url(JSON.stringify(payload))
  const sig = await sign(payloadEnc, secret)
  return `chm_${payloadEnc}.${bytesToB64url(sig)}`
}

export type ApiKeyVerificationResult = {
  valid: boolean
  reason?: string
  sub?: string
  /** Present when the token stamped scopes; undefined means all scopes. */
  scopes?: string[]
}

/**
 * verifyApiKey intentionally accepts any token when getSecret returns null.
 * That means CHM_API_KEY_SECRET is unset and API-key auth is disabled.
 */
export async function verifyApiKey(
  token: string
): Promise<ApiKeyVerificationResult> {
  const secret = getSecret()
  if (!secret) return { valid: true }
  if (!token.startsWith('chm_'))
    return { valid: false, reason: 'invalid prefix' }

  try {
    const raw = token.slice(4)
    const [payloadEnc, sigEnc] = raw.split('.')
    if (!payloadEnc || !sigEnc)
      return { valid: false, reason: 'malformed token' }

    const expected = await sign(payloadEnc, secret)
    const provided = unb64url(sigEnc)
    if (!provided) return { valid: false, reason: 'malformed signature' }
    if (!constantTimeEqual(expected, provided)) {
      return { valid: false, reason: 'bad signature' }
    }

    const payloadBytes = unb64url(payloadEnc)
    if (!payloadBytes) return { valid: false, reason: 'malformed payload' }

    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes)
    ) as Payload
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return { valid: false, reason: 'expired' }

    return {
      valid: true,
      sub: payload.sub,
      scopes: payload.scopes,
    }
  } catch {
    return { valid: false, reason: 'malformed token' }
  }
}

export function apiKeyAuthEnabled() {
  return Boolean(getSecret())
}

/** Whether a verified key grants `scope` (missing scopes = all). */
export function apiKeyHasScope(
  result: ApiKeyVerificationResult,
  scope: ApiKeyScope
): boolean {
  if (!result.valid) return false
  if (!result.scopes || result.scopes.length === 0) return true
  return result.scopes.includes(scope)
}
