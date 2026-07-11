/**
 * GitHub App authentication (the `duyetbot` app) for cloud-hooks.
 *
 * The exception scan files GitHub issues. It can authenticate as a **GitHub
 * App installation** instead of / in addition to a personal access token (PAT):
 *
 *   1. Mint a short-lived **app JWT** (RS256) signed with WebCrypto from the
 *      app's PEM private key — no npm `jsonwebtoken` dependency.
 *   2. Exchange it for an **installation access token**
 *      (`POST /app/installations/{installation_id}/access_tokens`), resolving
 *      the installation id once (`GET /repos/{owner}/{repo}/installation`) when
 *      `GH_APP_INSTALLATION_ID` is unset and caching it in KV.
 *   3. Cache the installation token in KV until ~5 min before its 1h expiry.
 *
 * Everything is injected (fetch / KV / clock) and unit-tested without the
 * network. Auth resolution order lives in `resolveGitHubAuth`: App creds win,
 * then a PAT, else disabled.
 */

import type { KVLike } from './exceptions'

/** Cache keys (versioned so a format change is a clean cutover). */
const KV_INSTALL_ID_PREFIX = 'gh-app:install-id:v1:'
const KV_TOKEN_PREFIX = 'gh-app:token:v1:'

/** Refresh an installation token this many ms before its stated expiry. */
export const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000

const DEFAULT_API_BASE = 'https://api.github.com'
const UA = 'chmonitor-hooks'

// ── base64 / base64url helpers ──────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function stringToBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input))
}

// ── private key handling ────────────────────────────────────────────────────

/**
 * Normalize a PEM private-key secret into raw PKCS#8 DER bytes.
 *
 * - Handles escaped newlines (`\n`) — env secrets are often single-line.
 * - Accepts PKCS#8 (`BEGIN PRIVATE KEY`), which WebCrypto imports directly.
 * - Rejects PKCS#1 (`BEGIN RSA PRIVATE KEY`) with a clear, actionable message
 *   instead of a cryptic WebCrypto `importKey` throw.
 */
export function normalizePrivateKey(pem: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, '\n').trim()

  if (/BEGIN RSA PRIVATE KEY/.test(normalized)) {
    throw new Error(
      'GH_APP_PRIVATE_KEY is in PKCS#1 format (BEGIN RSA PRIVATE KEY), which ' +
        'WebCrypto cannot import. Convert it to PKCS#8 once with:\n' +
        '  openssl pkcs8 -topk8 -nocrypt -in app.private-key.pem -out app.pkcs8.pem\n' +
        'then set the PKCS#8 result (BEGIN PRIVATE KEY) as the secret.'
    )
  }

  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/
  )
  if (!match) {
    throw new Error(
      'GH_APP_PRIVATE_KEY is not a PKCS#8 PEM (expected a ' +
        '"-----BEGIN PRIVATE KEY-----" block).'
    )
  }

  const body = match[1].replace(/\s+/g, '')
  if (!body) throw new Error('GH_APP_PRIVATE_KEY PEM body is empty.')
  return base64ToBytes(body)
}

async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = normalizePrivateKey(pem)
  return crypto.subtle.importKey(
    'pkcs8',
    der as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

// ── app JWT ─────────────────────────────────────────────────────────────────

export interface JwtClaims {
  /** issued-at, backdated 60s to tolerate minor clock skew (GitHub guidance). */
  iat: number
  /** expiry, +9 min (GitHub rejects app JWTs with >10 min lifetime). */
  exp: number
  /** the GitHub App id. */
  iss: string
}

/** Build the RS256 JWT claim set for a GitHub App (pure — unit-tested). */
export function buildJwtClaims(appId: string, nowMs: number): JwtClaims {
  const nowSec = Math.floor(nowMs / 1000)
  return {
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: appId,
  }
}

/** Mint a signed RS256 app JWT via WebCrypto. */
export async function createAppJwt(
  appId: string,
  privateKeyPem: string,
  nowMs: number = Date.now()
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = buildJwtClaims(appId, nowMs)
  const signingInput = `${stringToBase64Url(
    JSON.stringify(header)
  )}.${stringToBase64Url(JSON.stringify(claims))}`

  const key = await importSigningKey(privateKeyPem)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  )
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`
}

// ── installation id + token ─────────────────────────────────────────────────

export interface GitHubAppConfig {
  appId: string
  privateKeyPem: string
  /** Explicit installation id; when unset it is resolved from the repo + cached. */
  installationId?: string
  owner: string
  repo: string
}

interface CachedToken {
  token: string
  /** unix ms — GitHub's `expires_at` parsed. */
  expiresAt: number
}

/**
 * Resolve the installation id for the app on `owner/repo`, caching it in KV.
 * Uses the app JWT (`GET /repos/{owner}/{repo}/installation`).
 */
export async function resolveInstallationId(
  cfg: GitHubAppConfig,
  jwt: string,
  kv: KVLike | null | undefined,
  fetchImpl: typeof fetch = fetch,
  apiBase = DEFAULT_API_BASE
): Promise<string> {
  if (cfg.installationId) return cfg.installationId

  const cacheKey = `${KV_INSTALL_ID_PREFIX}${cfg.owner}/${cfg.repo}`
  if (kv) {
    try {
      const cached = await kv.get(cacheKey)
      if (cached) return cached
    } catch {
      /* ignore — fall through to a live lookup */
    }
  }

  const url = `${apiBase}/repos/${cfg.owner}/${cfg.repo}/installation`
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `GitHub App installation lookup failed (${res.status}) for ${cfg.owner}/${cfg.repo}: ${text}`
    )
  }
  const data = (await res.json()) as { id?: number }
  if (!data.id) {
    throw new Error(
      `GitHub App installation lookup returned no id for ${cfg.owner}/${cfg.repo}.`
    )
  }
  const id = String(data.id)
  if (kv) {
    try {
      await kv.put(cacheKey, id)
    } catch {
      /* ignore */
    }
  }
  return id
}

/** Mint a fresh installation access token from the app JWT + installation id. */
export async function mintInstallationToken(
  installationId: string,
  jwt: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = DEFAULT_API_BASE
): Promise<CachedToken> {
  const url = `${apiBase}/app/installations/${installationId}/access_tokens`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `GitHub App token exchange failed (${res.status}) for installation ${installationId}: ${text}`
    )
  }
  const data = (await res.json()) as { token?: string; expires_at?: string }
  if (!data.token) {
    throw new Error('GitHub App token exchange returned no token.')
  }
  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : NaN
  return {
    token: data.token,
    // Fall back to a conservative 55-min lifetime if expires_at is unparseable.
    expiresAt: Number.isNaN(expiresAt) ? Date.now() + 55 * 60_000 : expiresAt,
  }
}

/** True when a cached token is still safely within its validity margin. */
export function isTokenFresh(cached: CachedToken, nowMs: number): boolean {
  return nowMs < cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS
}

export interface GitHubAppAuthDeps {
  cfg: GitHubAppConfig
  kv?: KVLike | null
  fetch?: typeof fetch
  apiBase?: string
  now?: () => number
}

/**
 * A GitHub App token provider with a KV-backed installation-token cache.
 * `getToken()` returns a valid installation token, minting a new one (and a
 * fresh app JWT + installation id) only when the cache is empty or near expiry.
 * `getToken(true)` forces a refresh — used to recover from a mid-flight 401.
 */
export class GitHubAppAuth {
  private readonly cfg: GitHubAppConfig
  private readonly kv: KVLike | null
  private readonly fetchImpl: typeof fetch
  private readonly apiBase: string
  private readonly now: () => number
  private readonly tokenKey: string

  constructor(deps: GitHubAppAuthDeps) {
    this.cfg = deps.cfg
    this.kv = deps.kv ?? null
    this.fetchImpl = deps.fetch ?? fetch
    this.apiBase = deps.apiBase ?? DEFAULT_API_BASE
    this.now = deps.now ?? Date.now
    this.tokenKey = `${KV_TOKEN_PREFIX}${this.cfg.owner}/${this.cfg.repo}`
  }

  private async readCache(): Promise<CachedToken | null> {
    if (!this.kv) return null
    try {
      const raw = await this.kv.get(this.tokenKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as CachedToken
      if (
        typeof parsed.token === 'string' &&
        typeof parsed.expiresAt === 'number'
      )
        return parsed
    } catch {
      /* ignore — treat as a cache miss */
    }
    return null
  }

  private async writeCache(token: CachedToken): Promise<void> {
    if (!this.kv) return
    try {
      await this.kv.put(this.tokenKey, JSON.stringify(token))
    } catch {
      /* ignore */
    }
  }

  async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = await this.readCache()
      if (cached && isTokenFresh(cached, this.now())) return cached.token
    }

    const jwt = await createAppJwt(
      this.cfg.appId,
      this.cfg.privateKeyPem,
      this.now()
    )
    const installationId = await resolveInstallationId(
      this.cfg,
      jwt,
      this.kv,
      this.fetchImpl,
      this.apiBase
    )
    const minted = await mintInstallationToken(
      installationId,
      jwt,
      this.fetchImpl,
      this.apiBase
    )
    await this.writeCache(minted)
    return minted.token
  }
}

/**
 * Run a token-consuming GitHub operation, refreshing the App token once if it
 * comes back 401 (a token revoked/expired earlier than its stated `expires_at`).
 * PAT auth (no provider) never refreshes — a 401 is returned as-is.
 */
export async function withTokenRefresh<T extends { status: number }>(
  auth: GitHubAppAuth | null,
  op: (token: string) => Promise<T>,
  initialToken: string
): Promise<T> {
  const first = await op(initialToken)
  if (first.status !== 401 || !auth) return first
  const refreshed = await auth.getToken(true)
  return op(refreshed)
}

// ── auth resolution ─────────────────────────────────────────────────────────

export type GitHubAuthMode = 'app' | 'pat' | 'disabled'

export interface ResolvedGitHubAuth {
  mode: GitHubAuthMode
  /** Present for `app` mode — mints/caches installation tokens. */
  app?: GitHubAppAuth
  /** Present for `pat` mode — the static PAT. */
  token?: string
}

export interface GitHubAuthEnv {
  GH_APP_ID?: string
  GH_APP_PRIVATE_KEY?: string
  GH_APP_INSTALLATION_ID?: string
  GITHUB_TOKEN?: string
}

/**
 * Resolve GitHub auth for issue creation. Order: App creds (`GH_APP_ID` +
 * `GH_APP_PRIVATE_KEY`) → PAT (`GITHUB_TOKEN`) → disabled.
 */
export function resolveGitHubAuth(
  env: GitHubAuthEnv,
  owner: string,
  repo: string,
  kv: KVLike | null | undefined,
  fetchImpl?: typeof fetch,
  apiBase?: string
): ResolvedGitHubAuth {
  if (env.GH_APP_ID && env.GH_APP_PRIVATE_KEY) {
    const app = new GitHubAppAuth({
      cfg: {
        appId: env.GH_APP_ID,
        privateKeyPem: env.GH_APP_PRIVATE_KEY,
        installationId: env.GH_APP_INSTALLATION_ID,
        owner,
        repo,
      },
      kv,
      fetch: fetchImpl,
      apiBase,
    })
    return { mode: 'app', app }
  }
  if (env.GITHUB_TOKEN) {
    return { mode: 'pat', token: env.GITHUB_TOKEN }
  }
  return { mode: 'disabled' }
}
