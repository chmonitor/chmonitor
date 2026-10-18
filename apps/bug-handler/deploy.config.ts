// Env vars and secrets for scripts/deploy-worker.ts. wrangler.toml ships the
// defaults; listing a var here only lets env files override it.
export default {
  vars: [
    'GITHUB_REPOSITORY',
    'BUG_ISSUE_LABELS',
    'BUG_ISSUE_ASSIGNEES',
    'BUG_ISSUE_TITLE_PREFIX',
    'BUG_HANDLER_TARGET_ADDRESS',
    // Sender allowlist for inbound email (src/config.ts). Optional — unset
    // falls back to the built-in Sentry-only list; '*' accepts any sender.
    'BUG_ALLOWED_SENDERS',
    // Optional GitHub Enterprise API base override (src/config.ts). Unset
    // falls back to the public github.com API.
    'GITHUB_API_BASE',
  ],
  secrets: ['GITHUB_TOKEN'],
}
