// chmonitor bug-handler — Cloudflare Email Worker
//
// This worker is the target of a Cloudflare Email Routing rule that forwards
// inbound mail sent to a configured address (e.g. bug@chmonitor.dev) to this
// worker.  It parses the email, extracts Sentry alert metadata when present,
// and opens a well-formatted GitHub issue automatically.
//
// Pipeline:
//   Sentry alert → email → Cloudflare Email Routing → this worker → GitHub issue
//
// Everything is configurable via environment variables — the target address,
// GitHub repository, labels, assignees, and token are all injected at deploy
// time or via `wrangler secret put`.  Nothing is hardcoded.
//
// Email Routing setup (Cloudflare dashboard, NOT wrangler):
//   Zone: chmonitor.dev → Email → Email Routing
//   Rule: Custom address  bug@chmonitor.dev  →  Send to Worker  →  chmonitor-bug-handler
//
// Required secrets (set via `wrangler secret put GITHUB_TOKEN`):
//   GITHUB_TOKEN — PAT or GitHub App installation token with issues:write

import { isSenderAllowed, parseConfig } from './config'
import { buildIssue, createGitHubIssue } from './github-issue'
import { parseEmail } from './parse-email'

// Cloudflare Workers env bindings — all values arrive as strings or undefined.
export interface Env {
  // Target recipient address for this worker (e.g. bug@chmonitor.dev).
  // When unset the worker accepts mail sent to any address.
  BUG_HANDLER_TARGET_ADDRESS?: string

  // GitHub repository in "owner/repo" format.  Required for issue creation.
  GITHUB_REPOSITORY?: string

  // GitHub PAT or App token with issues:write.  Set via `wrangler secret put`.
  GITHUB_TOKEN?: string

  // Comma-separated issue labels (default: bug,sentry,automated).
  BUG_ISSUE_LABELS?: string

  // Comma-separated GitHub usernames to assign (default: none).
  BUG_ISSUE_ASSIGNEES?: string

  // Optional prefix prepended to the issue title (default: '').
  BUG_ISSUE_TITLE_PREFIX?: string

  // Comma-separated allowed sender addresses / domains. Unset defaults to
  // Sentry's known sending domains (fail closed); "" rejects every sender;
  // "*" explicitly allows every sender.
  BUG_ALLOWED_SENDERS?: string

  // GitHub API base URL — override for GitHub Enterprise or tests.
  GITHUB_API_BASE?: string
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    try {
      // 1. Parse runtime configuration from env
      const config = parseConfig(env as Record<string, string | undefined>)

      // 2. Recipient guard — ignore mail not addressed to the configured target
      if (
        config.targetAddress &&
        message.to.toLowerCase() !== config.targetAddress.toLowerCase()
      ) {
        console.log(
          `[bug-handler] ignoring mail to ${message.to} (expected ${config.targetAddress})`
        )
        return
      }

      // 3. Parse the raw MIME message
      const parsed = await parseEmail(message.raw)

      // 4. Sender allowlist check — use the SMTP envelope sender (message.from)
      //    which is what Cloudflare Email Routing validated at the protocol level,
      //    not the MIME From header which can be spoofed. Log sender + subject
      //    so operators notice when legitimate mail is being dropped (e.g.
      //    BUG_ALLOWED_SENDERS misconfigured, or Sentry changed its sending domain).
      if (!isSenderAllowed(message.from, config.allowedSenders)) {
        console.warn(
          `[bug-handler] rejected envelope sender ${message.from} (subject: "${parsed.subject}") — not in allowedSenders list`
        )
        return
      }

      // 5. Misconfiguration guard — log clearly and bail without crashing
      if (!config.githubRepo) {
        console.error(
          '[bug-handler] GITHUB_REPOSITORY is missing or malformed — ' +
            'set it to "owner/repo".  No issue will be created.'
        )
        return
      }
      if (!config.githubToken) {
        console.error(
          '[bug-handler] GITHUB_TOKEN is not set — ' +
            'run `wrangler secret put GITHUB_TOKEN`.  No issue will be created.'
        )
        return
      }

      // 6. Build the issue payload
      const issue = buildIssue(parsed, config)

      // 7. Create the GitHub issue (use waitUntil so the email handler returns
      //    promptly while the API call completes in the background)
      ctx.waitUntil(
        createGitHubIssue(issue, config).then((result) => {
          if (result.ok) {
            console.log(
              `[bug-handler] GitHub issue created: ${result.url ?? '(no url)'}`
            )
          } else {
            console.error(
              `[bug-handler] GitHub API error ${result.status}: ${result.error}`
            )
          }
        })
      )
    } catch (err) {
      // Top-level catch: log the error without re-throwing so the worker never
      // surfaces an unhandled rejection to Cloudflare's runtime.
      console.error('[bug-handler] unexpected error:', err)
    }
  },
}
