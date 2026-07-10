// config.ts — pure configuration parsing for the bug-handler worker.
//
// All behavioural knobs come from environment variables so that the same
// worker binary can serve different repos, addresses, and label sets without
// a redeploy.  No side effects — safe to call in tests with plain objects.

export interface GitHubRepo {
  owner: string
  repo: string
}

export interface BugHandlerConfig {
  // The recipient address this worker accepts mail for.  When unset the
  // worker accepts any recipient (useful for catch-all routing rules).
  targetAddress: string | undefined

  // Parsed "owner/repo" from GITHUB_REPOSITORY.  null when the env var is
  // missing or malformed — the caller logs an error and skips issue creation.
  githubRepo: GitHubRepo | null

  // Personal Access Token or GitHub App installation token with issues:write.
  githubToken: string | undefined

  // Labels applied to every opened issue.
  labels: string[]

  // GitHub usernames to assign (empty = no assignment).
  assignees: string[]

  // Optional prefix prepended to the issue title (e.g. "[Sentry] ").
  titlePrefix: string

  // Senders (exact address or @domain suffix) allowed to create issues.
  // See `parseConfig` for how BUG_ALLOWED_SENDERS maps to this list:
  // unset -> built-in Sentry default, "" -> reject all, "*" -> allow all.
  allowedSenders: string[]

  // Base URL for the GitHub REST API.  Overridable for tests / GHES.
  apiBase: string
}

const DEFAULT_LABELS = ['bug', 'sentry', 'automated']
const DEFAULT_API_BASE = 'https://api.github.com'

// This worker exists to turn Sentry alert mail into GitHub issues — when the
// operator hasn't set BUG_ALLOWED_SENDERS at all, fail closed to Sentry's
// known sending domains instead of accepting mail from anyone.
const DEFAULT_ALLOWED_SENDERS = ['@sentry.io', '@notifications.sentry.io']

// Explicit opt-out: BUG_ALLOWED_SENDERS=* accepts mail from any sender.
const ALLOW_ALL_SENDERS = '*'

/** Split a comma-separated env value into a trimmed, non-empty string array. */
function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Parse a "owner/repo" string into its components.
 * Returns null when the value is missing or does not contain exactly one "/".
 */
function parseRepo(raw: string | undefined): GitHubRepo | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return null
  // Reject more than one slash to catch malformed values like "a/b/c".
  if (trimmed.indexOf('/', slash + 1) !== -1) return null
  return {
    owner: trimmed.slice(0, slash),
    repo: trimmed.slice(slash + 1),
  }
}

/**
 * Build a `BugHandlerConfig` from the raw environment object.
 * Never throws — missing/malformed required values are represented as null/undefined
 * so the caller can emit a single coherent error message.
 */
export function parseConfig(
  env: Record<string, string | undefined>
): BugHandlerConfig {
  const rawTarget = env.BUG_HANDLER_TARGET_ADDRESS?.trim()

  const rawLabels = splitList(env.BUG_ISSUE_LABELS)
  const labels = rawLabels.length > 0 ? rawLabels : DEFAULT_LABELS

  const assignees = splitList(env.BUG_ISSUE_ASSIGNEES)

  // allowedSenders: lower-case for case-insensitive matching.
  //   - unset (BUG_ALLOWED_SENDERS not set at all) -> built-in Sentry-only
  //     default, so the worker fails closed instead of accepting any sender.
  //   - "" (explicitly set to empty)               -> reject every sender.
  //   - "*"                                        -> explicit opt-out,
  //     allow every sender.
  //   - comma list                                 -> parsed allowlist.
  const allowedSenders =
    env.BUG_ALLOWED_SENDERS === undefined
      ? DEFAULT_ALLOWED_SENDERS
      : splitList(env.BUG_ALLOWED_SENDERS).map((s) => s.toLowerCase())

  return {
    targetAddress: rawTarget || undefined,
    githubRepo: parseRepo(env.GITHUB_REPOSITORY),
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    labels,
    assignees,
    titlePrefix: env.BUG_ISSUE_TITLE_PREFIX ?? '',
    allowedSenders,
    apiBase: env.GITHUB_API_BASE?.trim() || DEFAULT_API_BASE,
  }
}

/**
 * Return true when `address` is permitted according to the allowedSenders list.
 *
 * `allowedSenders` is fail-closed: an empty list rejects every sender (see
 * `parseConfig` for how BUG_ALLOWED_SENDERS maps to this list). To allow
 * every sender, include the "*" sentinel.
 *
 * Matching rules (case-insensitive):
 *   - Wildcard:     "*"                 matches every address
 *   - Exact match:  "alerts@sentry.io"  matches  "alerts@sentry.io"
 *   - Domain match: "@sentry.io"        matches any address ending in @sentry.io
 *   - Plain domain: "sentry.io"         matches any address ending in @sentry.io
 *                   (requires the @ boundary — "notsentry.io" does NOT match)
 */
export function isSenderAllowed(
  address: string,
  allowedSenders: string[]
): boolean {
  if (allowedSenders.includes(ALLOW_ALL_SENDERS)) return true
  const lower = address.toLowerCase()
  return allowedSenders.some((rule) => {
    if (rule.startsWith('@')) {
      // Domain rule: @sentry.io — address must end with exactly this.
      return lower.endsWith(rule)
    }
    if (rule.includes('@')) {
      // Exact address rule: alerts@sentry.io
      return lower === rule
    }
    // Plain domain rule: "sentry.io" — require the @ boundary so that
    // "notsentry.io" does NOT match when the rule is "sentry.io".
    return lower.endsWith(`@${rule}`)
  })
}
