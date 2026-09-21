/**
 * Host-URL credential redaction.
 *
 * Lives in its own dependency-free module so it can be imported via the
 * `@chm/clickhouse-client/redact-host` subpath in code paths where the package
 * root is not safe to load (e.g. unit tests that mock the root specifier, and
 * edge bundles that tree-shake the client factory).
 */

/**
 * Redacts username and password credentials from a ClickHouse host URL string
 */
export function redactHostCredentials(urlStr: string): string {
  // Fast-path: no '@' means no credentials to redact.
  if (!urlStr.includes('@')) {
    return urlStr
  }
  try {
    const url = new URL(urlStr)
    // Only trust the parse result for http/https — other inputs (e.g.
    // "admin:secret@host") are silently parsed with "admin:" as the scheme
    // and no username/password, so we fall through to the regex path.
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.username) url.username = '***'
      if (url.password) url.password = '***'
      return url.toString()
    }
  } catch {
    // URL constructor threw — fall through to regex below.
  }
  // Fallback for URLs without a recognized protocol (e.g. "admin:secret@host:8123").
  // Handles user:pass@, :pass@ (password-only), and user@ (username-only).
  return urlStr.replace(
    /(?:(https?:\/\/))?([^:@]*)(?::([^@]*))?@/,
    (_, proto, user, pass) => {
      const redactedUser = user ? '***' : ''
      const redactedPass = pass !== undefined ? ':***' : ''
      return `${proto ?? ''}${redactedUser}${redactedPass}@`
    }
  )
}
