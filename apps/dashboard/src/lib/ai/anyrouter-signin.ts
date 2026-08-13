/**
 * "Sign in with AnyRouter" — browser OAuth 2.1 + PKCE popup flow that mints a
 * short-lived, per-user AnyRouter inference token for BYOK agent requests,
 * without any deploy-time `ANYROUTER_API_KEY`.
 *
 * ## Verified upstream contract (anyrouter.dev, re-checked 2026-08-13)
 *
 * Source of truth: https://anyrouter.dev/docs/guides/sign-in-with-anyrouter.md
 * — this is the flow documented specifically for browser sign-in and the one
 * this module implements.
 *
 * A second page, https://anyrouter.dev/docs/api-reference/oauth.md, documents
 * a DIFFERENT, older pair of flows: `POST /api/v1/auth/keys/code` +
 * `POST /api/v1/keys` (a Bearer-authenticated API-key-exchange flow, not
 * usable for an anonymous browser sign-in), and a device-authorization grant
 * at `/api/v1/oauth/device/code`. Neither matches the sign-in guide, and the
 * device flow rejected an unregistered `client_id` in a live probe — so this
 * module follows the `/api/v1/mcp/oauth/*` endpoints below, not the
 * api-reference page.
 *
 * 1. **Registration** (dynamic client registration, no auth required):
 *    `POST https://anyrouter.dev/api/v1/mcp/oauth/register`
 *      `{ client_name, redirect_uris: string[], app_type: 'signin', origin_url }`
 *      → `{ client_id, ... }` — `client_id` is public, safe to reuse.
 *    Cached in module memory for the process lifetime, keyed by `origin_url`.
 *    `ANYROUTER_OAUTH_CLIENT_ID` env var overrides/bypasses registration
 *    entirely, letting a deployment pin a pre-registered client.
 *
 * 2. **Authorize** (the browser popup is redirected here directly — the
 *    server never fetches this URL):
 *    `GET https://anyrouter.dev/api/v1/mcp/oauth/authorize`
 *      `?client_id&redirect_uri&response_type=code&code_challenge&code_challenge_method=S256&state`
 *
 * 3. **Token exchange**:
 *    `POST https://anyrouter.dev/api/v1/mcp/oauth/token`
 *      `{ grant_type: 'authorization_code', code, redirect_uri, client_id, code_verifier }`
 *      → `{ access_token, token_type: 'Bearer', scope, expires_in }`.
 *    Scopes are always exactly `inference read:profile`. `expires_in` is
 *    ~2,592,000s (30 days) and there are **no refresh tokens** — a `401` from
 *    AnyRouter means the user must repeat this flow from scratch.
 *
 * Redirect URIs must exact-match a registered URI and be HTTPS, except
 * `localhost`/`127.0.0.1` for local dev. The client is public (no client
 * secret is ever issued or needed).
 *
 * ## Token handling
 *
 * The minted `access_token` is NEVER persisted server-side and NEVER logged —
 * mirrors the discipline documented in `lib/ai/agent/byok.ts`. It is handed to
 * the browser exactly once, via `postMessage` from the callback popup, and
 * from then on flows through the existing BYOK `apiKey` request field that the
 * client already sends per-request.
 */

export const ANYROUTER_OAUTH_BASE = 'https://anyrouter.dev/api/v1/mcp/oauth'
export const ANYROUTER_REGISTER_URL = `${ANYROUTER_OAUTH_BASE}/register`
export const ANYROUTER_AUTHORIZE_URL = `${ANYROUTER_OAUTH_BASE}/authorize`
export const ANYROUTER_TOKEN_URL = `${ANYROUTER_OAUTH_BASE}/token`

/** Path prefix both the login and callback routes live under; scopes the cookie. */
export const ANYROUTER_SIGNIN_COOKIE_PATH = '/api/v1/agents/anyrouter'
export const ANYROUTER_SIGNIN_COOKIE_NAME = 'chm_anyrouter_pkce'
/** Cookie lifetime: the user has 10 minutes to complete the popup flow. */
export const ANYROUTER_SIGNIN_COOKIE_MAX_AGE_SECONDS = 60 * 10
export const ANYROUTER_CALLBACK_PATH = `${ANYROUTER_SIGNIN_COOKIE_PATH}/callback`

/** `postMessage` type tag the callback page sends to `window.opener`. */
export const ANYROUTER_SIGNIN_MESSAGE_TYPE = 'chm:anyrouter-signin'

const OAUTH_CLIENT_NAME = 'chmonitor'
const DEFAULT_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60 // 30 days, per the docs

/** Raised for any AnyRouter sign-in failure with a message safe to surface to the user. */
export class AnyRouterSigninError extends Error {}

// ── base64url + PKCE ─────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a PKCE code verifier: 32 random bytes, base64url-encoded. */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** Derive the S256 PKCE code challenge for a verifier (WebCrypto only — Worker-safe). */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return toBase64Url(new Uint8Array(digest))
}

/** Generate an opaque CSRF `state` token. */
export function generateState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

// ── redirect URI / origin derivation ─────────────────────────────────────

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

/**
 * Derive the OAuth `redirect_uri` (this app's callback route) from the
 * incoming request. Refuses non-HTTPS origins except localhost/127.0.0.1 —
 * AnyRouter requires an exact-match HTTPS redirect URI in production.
 */
export function deriveRedirectUri(request: Request): string {
  const url = new URL(request.url)
  if (url.protocol !== 'https:' && !isLocalHostname(url.hostname)) {
    throw new AnyRouterSigninError(
      'AnyRouter sign-in requires an HTTPS origin (localhost is allowed for development)'
    )
  }
  return `${url.protocol}//${url.host}${ANYROUTER_CALLBACK_PATH}`
}

/** Derive this app's public origin (`scheme://host`) from the incoming request. */
export function deriveOriginUrl(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

// ── client registration (cached) ─────────────────────────────────────────

interface RegisterResponse {
  client_id?: string
}

let cachedClientId: string | null = null
let cachedClientIdOrigin: string | null = null

/**
 * Lazily register (or reuse a cached / env-pinned) OAuth `client_id`.
 * `ANYROUTER_OAUTH_CLIENT_ID` lets a deployment pin a pre-registered client
 * and skip the registration round trip entirely.
 */
export async function getOrRegisterClientId(
  redirectUri: string,
  originUrl: string,
  env: { ANYROUTER_OAUTH_CLIENT_ID?: string } = {}
): Promise<string> {
  if (env.ANYROUTER_OAUTH_CLIENT_ID) return env.ANYROUTER_OAUTH_CLIENT_ID

  if (cachedClientId && cachedClientIdOrigin === originUrl)
    return cachedClientId

  let response: Response
  try {
    response = await fetch(ANYROUTER_REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: OAUTH_CLIENT_NAME,
        redirect_uris: [redirectUri],
        app_type: 'signin',
        origin_url: originUrl,
      }),
    })
  } catch {
    throw new AnyRouterSigninError(
      'Could not reach AnyRouter to register a client'
    )
  }

  if (!response.ok) {
    throw new AnyRouterSigninError(
      `AnyRouter client registration failed (${response.status})`
    )
  }

  const data = (await response.json()) as RegisterResponse
  if (!data.client_id) {
    throw new AnyRouterSigninError(
      'AnyRouter client registration returned no client_id'
    )
  }

  cachedClientId = data.client_id
  cachedClientIdOrigin = originUrl
  return cachedClientId
}

/** Test-only reset of the module-level `client_id` cache. */
export function __resetClientIdCacheForTests(): void {
  cachedClientId = null
  cachedClientIdOrigin = null
}

// ── start flow: authorize URL ────────────────────────────────────────────

export interface StartSigninResult {
  authorizeUrl: string
  state: string
  codeVerifier: string
}

/**
 * Build the AnyRouter `authorize` URL for a fresh sign-in attempt: derives
 * the redirect URI from the request, registers (or reuses) a client, and
 * generates a fresh PKCE pair + CSRF state. Callers are responsible for
 * persisting `state` + `codeVerifier` (e.g. in the signin cookie) and never
 * returning `codeVerifier` to the browser.
 */
export async function buildAuthorizeUrl(
  request: Request,
  env: { ANYROUTER_OAUTH_CLIENT_ID?: string } = {}
): Promise<StartSigninResult> {
  const redirectUri = deriveRedirectUri(request)
  const originUrl = deriveOriginUrl(request)
  const clientId = await getOrRegisterClientId(redirectUri, originUrl, env)

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await deriveCodeChallenge(codeVerifier)
  const state = generateState()

  const url = new URL(ANYROUTER_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  return { authorizeUrl: url.toString(), state, codeVerifier }
}

// ── PKCE/state cookie ─────────────────────────────────────────────────────

export interface SigninCookiePayload {
  /** PKCE code_verifier. */
  v: string
  /** CSRF state. */
  s: string
}

/** Build the `Set-Cookie` header value that stores the PKCE pair for the callback. */
export function serializeSigninCookie(
  payload: SigninCookiePayload,
  opts: { secure: boolean }
): string {
  const value = encodeURIComponent(JSON.stringify(payload))
  const attrs = [
    `${ANYROUTER_SIGNIN_COOKIE_NAME}=${value}`,
    `Path=${ANYROUTER_SIGNIN_COOKIE_PATH}`,
    `Max-Age=${ANYROUTER_SIGNIN_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (opts.secure) attrs.push('Secure')
  return attrs.join('; ')
}

/** Build the `Set-Cookie` header value that clears the signin cookie. */
export function clearSigninCookieHeader(opts: { secure: boolean }): string {
  const attrs = [
    `${ANYROUTER_SIGNIN_COOKIE_NAME}=`,
    `Path=${ANYROUTER_SIGNIN_COOKIE_PATH}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (opts.secure) attrs.push('Secure')
  return attrs.join('; ')
}

/** Parse the signin cookie out of an incoming `Cookie` header, if present and well-formed. */
export function parseSigninCookie(
  cookieHeader: string | null | undefined
): SigninCookiePayload | null {
  if (!cookieHeader) return null

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name !== ANYROUTER_SIGNIN_COOKIE_NAME) continue

    const raw = part.slice(eq + 1).trim()
    try {
      const parsed = JSON.parse(
        decodeURIComponent(raw)
      ) as Partial<SigninCookiePayload>
      if (typeof parsed.v === 'string' && typeof parsed.s === 'string') {
        return { v: parsed.v, s: parsed.s }
      }
    } catch {
      return null
    }
    return null
  }

  return null
}

// ── token exchange ───────────────────────────────────────────────────────

export interface TokenExchangeResult {
  accessToken: string
  tokenType: string
  scope: string
  /** Unix ms expiry, derived from `expires_in`. */
  expiresAt: number
}

/**
 * Exchange an authorization `code` (+ its PKCE verifier) for an AnyRouter
 * access token. Never includes the response body or the exchanged token in
 * any thrown error — only the HTTP status is surfaced.
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string
): Promise<TokenExchangeResult> {
  let response: Response
  try {
    response = await fetch(ANYROUTER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    })
  } catch {
    throw new AnyRouterSigninError(
      'Could not reach AnyRouter to exchange the sign-in code'
    )
  }

  if (!response.ok) {
    throw new AnyRouterSigninError(
      `AnyRouter token exchange failed (${response.status})`
    )
  }

  let data: {
    access_token?: string
    token_type?: string
    scope?: string
    expires_in?: number
  }
  try {
    data = await response.json()
  } catch {
    throw new AnyRouterSigninError(
      'AnyRouter token exchange returned an invalid response'
    )
  }

  if (!data.access_token) {
    throw new AnyRouterSigninError(
      'AnyRouter token exchange returned no access_token'
    )
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? 'Bearer',
    scope: data.scope ?? 'inference read:profile',
    expiresAt:
      Date.now() + (data.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS) * 1000,
  }
}

// ── popup result page ─────────────────────────────────────────────────────

export type SigninResultMessage =
  | {
      type: typeof ANYROUTER_SIGNIN_MESSAGE_TYPE
      ok: true
      token: string
      expiresAt: number
    }
  | { type: typeof ANYROUTER_SIGNIN_MESSAGE_TYPE; ok: false; error: string }

/**
 * Render the tiny self-contained HTML page the callback route returns: it
 * `postMessage`s the result to `window.opener` (restricted to `targetOrigin`)
 * and closes the popup. The token appears once in this response body, by
 * design — it is never logged or persisted (see the module header).
 */
export function buildSigninResultHtml(
  result:
    | { ok: true; token: string; expiresAt: number }
    | { ok: false; error: string },
  targetOrigin: string
): string {
  const message: SigninResultMessage = result.ok
    ? {
        type: ANYROUTER_SIGNIN_MESSAGE_TYPE,
        ok: true,
        token: result.token,
        expiresAt: result.expiresAt,
      }
    : { type: ANYROUTER_SIGNIN_MESSAGE_TYPE, ok: false, error: result.error }

  const title = result.ok ? 'Signed in' : 'Sign-in failed'
  const statusText = result.ok
    ? 'Signed in — you can close this window.'
    : 'Sign-in failed — you can close this window.'

  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<p>${statusText}</p>
<script>
(function () {
  var message = ${JSON.stringify(message)};
  var targetOrigin = ${JSON.stringify(targetOrigin)};
  if (window.opener) {
    window.opener.postMessage(message, targetOrigin);
  }
  window.close();
})();
</script>
</body>
</html>`
}
