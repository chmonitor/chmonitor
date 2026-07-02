/**
 * Security response headers applied to every response.
 *
 * Covers MIME-sniffing protection, clickjacking prevention, referrer
 * information leakage, and feature gating.
 *
 * CSP is shipped in **report-only** mode (`Content-Security-Policy-Report-Only`)
 * on purpose: report-only never blocks a resource, so it cannot break the app.
 * It lets us observe (via the browser console) whether this policy would flag
 * any legitimate resource before we ever switch to an enforcing
 * `Content-Security-Policy`. The policy is deliberately conservative:
 *   - Users connect to arbitrary ClickHouse hosts and we load Clerk + Sentry,
 *     so `connect-src` allows any https/wss origin to avoid false positives.
 *   - `script-src`/`style-src` allow `'unsafe-inline'` (and `'unsafe-eval'`)
 *     because the Vite/React runtime and Clerk currently need them.
 *   - `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY`.
 * TODO: tighten and promote to an enforcing header once report-only shows the
 * policy does not flag legitimate resources in production.
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' https:",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Report-only: observed, never enforced — safe to ship (see comment above).
  'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY,
}

/**
 * Clone a Response with security headers appended.
 *
 * Preserves status, statusText, body, and all original headers.
 * Security headers overwrite any pre-existing values for the same names
 * (defence-in-depth — e.g. an API route that accidentally sets a permissive
 * X-Frame-Options gets corrected).
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
