/**
 * Connection-error classification for the "Test connection" flow.
 *
 * The test endpoint (`/api/v1/browser-connections/test`) returns a raw error
 * string from either the SSRF/URL validator or the ClickHouse client. Those
 * strings are accurate but cryptic ("Code: 516", "ECONNREFUSED", "Connections
 * to internal addresses are not allowed."). This module maps them to an
 * actionable kind with a human title, an explanation of the likely cause, a
 * concrete next step, and a docs link — so "click connect → see a detailed
 * error + link to the right docs page for each kind".
 *
 * Pure string heuristics: no dependency on the transport. Always returns a
 * result (falls back to `unknown`), and never throws.
 */

export type ConnectionErrorKind =
  | 'host_not_allowed'
  | 'invalid_url'
  | 'auth_failed'
  | 'access_denied'
  | 'database_not_found'
  | 'dns_error'
  | 'connection_refused'
  | 'tls_error'
  | 'timeout'
  | 'unknown'

export interface ClassifiedConnectionError {
  kind: ConnectionErrorKind
  /** Short, human title for the error banner. */
  title: string
  /** What likely went wrong, in plain language. */
  explanation: string
  /** The single most useful next step the user can take. */
  fix: string
  /** Docs slug (passed to docsSiteUrl) for the relevant troubleshooting page. */
  docsSlug: string
  /** The original, unmodified error string (shown as technical detail). */
  raw: string
}

interface Rule {
  kind: ConnectionErrorKind
  /** Lowercased substrings; any match selects this rule (first rule wins). */
  match: string[]
  title: string
  explanation: string
  fix: string
  docsSlug: string
}

// Order matters: more specific rules first. The first rule whose any-substring
// matches the lowercased message wins.
const RULES: Rule[] = [
  {
    kind: 'host_not_allowed',
    match: [
      'internal addresses are not allowed',
      'not allowed',
      'unable to resolve host safely',
      'dns pinning',
      'private',
      'loopback',
      'ssrf',
    ],
    title: 'Host not allowed',
    explanation:
      'The hosted service blocks connections to private, internal, or loopback addresses (SSRF protection). Cloud can only reach publicly routable ClickHouse endpoints.',
    fix: 'Use a public HTTPS endpoint (e.g. ClickHouse Cloud, or your server exposed on a public host/port). To monitor a private/LAN/Tailscale cluster, self-host ClickHouse Monitor inside your network and set CHM_ALLOW_PRIVATE_HOSTS=true (self-host only — the hosted cloud always blocks private addresses).',
    docsSlug: 'guides/connection-errors',
  },
  {
    kind: 'invalid_url',
    match: ['invalid host url', 'must be a full url', 'unsupported protocol'],
    title: 'Invalid host URL',
    explanation:
      'The host must be a full HTTP(S) URL including the scheme and port, not a bare hostname.',
    fix: 'Enter the URL as https://host:8443 (HTTPS, default secure port) or http://host:8123.',
    docsSlug: 'reference/connection-presets',
  },
  {
    kind: 'auth_failed',
    match: [
      'authentication failed',
      'auth failed',
      'code: 516',
      'password is incorrect',
      'wrong password',
      'invalid credentials',
      'access denied for user',
      '403',
      // Postgres: SQLSTATE 28P01 (invalid_password) / 28000 (invalid auth spec).
      'password authentication failed',
      '28p01',
      '28000',
    ],
    title: 'Authentication failed',
    explanation:
      'The server rejected the username or password. The endpoint was reachable, but the credentials were not accepted.',
    fix: 'Double-check the username and password. If the user is restricted by IP, allow the dashboard egress address. Usernames are case-sensitive.',
    docsSlug: 'getting-started/clickhouse-requirements',
  },
  {
    kind: 'access_denied',
    match: [
      'not enough privileges',
      'access_denied',
      'code: 497',
      'not granted',
      'requires a grant',
    ],
    title: 'Not enough permissions',
    explanation:
      'The credentials are valid but the user lacks the SELECT grants the dashboard needs on ClickHouse system tables.',
    fix: 'Grant the monitoring user SELECT on system.* (e.g. GRANT SELECT ON system.* TO monitoring). A read-only monitoring user is recommended.',
    docsSlug: 'getting-started/clickhouse-requirements',
  },
  {
    kind: 'database_not_found',
    // Postgres SQLSTATE 3D000 (invalid_catalog_name). The classifier is string-
    // based, so the route appends the SQLSTATE to the message (see the Postgres
    // test/create paths) to make this reliable regardless of message wording.
    match: ['3d000', 'database does not exist'],
    title: 'Database not found',
    explanation:
      'The Postgres server was reached and the credentials were accepted, but the target database does not exist.',
    fix: 'Check the database name — it is case-sensitive and must already exist on the server. Create it, or point at an existing database.',
    docsSlug: 'guides/connection-errors',
  },
  {
    kind: 'dns_error',
    match: [
      'enotfound',
      'getaddrinfo',
      'could not resolve',
      'name or service not known',
      'eai_again',
    ],
    title: 'Host not found',
    explanation:
      'The hostname could not be resolved via DNS. The address is likely misspelled or not publicly resolvable.',
    fix: 'Verify the hostname is spelled correctly and resolves publicly. Internal/VPN-only DNS names are not reachable from the hosted service.',
    docsSlug: 'guides/connection-errors',
  },
  {
    kind: 'connection_refused',
    match: [
      'econnrefused',
      'connection refused',
      'connect econnrefused',
      // Postgres: SQLSTATE 08006/08001 (connection failure) and the pg driver's
      // "the database system is starting up / cannot connect now" (57P03).
      '08006',
      '08001',
      '57p03',
    ],
    title: 'Connection refused',
    explanation:
      'The host resolved but refused the connection. The database may not be listening on that port, or a firewall is blocking it.',
    fix: 'Confirm the port (ClickHouse: 8443 HTTPS / 8123 HTTP; Postgres: usually 5432) and that the server accepts external connections and the firewall allows the dashboard.',
    docsSlug: 'guides/connection-errors',
  },
  {
    kind: 'tls_error',
    match: [
      'certificate',
      'self signed',
      'self-signed',
      'ssl',
      'tls',
      'unable to verify',
      'err_tls',
      'depth_zero_self_signed_cert',
      // Postgres: server without TLS while sslmode requires it.
      'does not support ssl',
    ],
    title: 'TLS / certificate error',
    explanation:
      'The TLS handshake failed — typically a self-signed or untrusted certificate, or an HTTPS/HTTP port mismatch.',
    fix: 'Use a valid, publicly trusted certificate on the ClickHouse HTTPS port. If the server is HTTP-only, use an http:// URL and the HTTP port (8123).',
    docsSlug: 'guides/connection-errors',
  },
  {
    kind: 'timeout',
    match: [
      'etimedout',
      'timeout',
      'timed out',
      'esockettimedout',
      // Postgres driver connect-timeout wording.
      'connection timeout',
    ],
    title: 'Connection timed out',
    explanation:
      'The host did not respond in time. It may be unreachable from the public internet, or a firewall is silently dropping packets.',
    fix: 'Confirm the endpoint is publicly reachable and the firewall/security group allows inbound traffic from the dashboard on the ClickHouse port.',
    docsSlug: 'guides/connection-errors',
  },
]

const FALLBACK: Omit<ClassifiedConnectionError, 'raw'> = {
  kind: 'unknown',
  title: 'Connection failed',
  explanation:
    'The connection could not be established. The error below is the raw message returned by ClickHouse or the network layer.',
  fix: 'Check the host URL, port, and credentials. The troubleshooting guide lists the most common causes.',
  docsSlug: 'guides/connection-errors',
}

/**
 * Classify a raw connection-error string into an actionable error.
 *
 * @param raw - The error message from the test endpoint (or any thrown error).
 */
export function classifyConnectionError(
  raw: string | null | undefined
): ClassifiedConnectionError {
  const message = (raw ?? '').trim()
  const haystack = message.toLowerCase()

  for (const rule of RULES) {
    if (rule.match.some((m) => haystack.includes(m))) {
      return {
        kind: rule.kind,
        title: rule.title,
        explanation: rule.explanation,
        fix: rule.fix,
        docsSlug: rule.docsSlug,
        raw: message,
      }
    }
  }

  return { ...FALLBACK, raw: message || 'Connection failed' }
}

/**
 * Extract a human error string from a test-endpoint JSON body, handling both
 * shapes: the test route's `{ ok:false, error: string }` and the shared error
 * builder's `{ success:false, error: { message } }` (validation/SSRF).
 */
export function extractConnectionErrorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object') {
      const m = (err as { message?: unknown }).message
      if (typeof m === 'string') return m
    }
  }
  return 'Connection failed'
}
