// Cloudflare Email Worker: Sentry alert mail -> Email Routing -> GitHub issue.
// Email Routing rule is set in the Cloudflare dashboard, not wrangler.
// Required secret: `wrangler secret put GITHUB_TOKEN` (issues:write).

import { isSenderAllowed, parseConfig } from './config'
import { buildIssue, createGitHubIssue } from './github-issue'
import { parseEmail } from './parse-email'

export interface Env {
  // When unset the worker accepts mail sent to any address.
  BUG_HANDLER_TARGET_ADDRESS?: string

  // "owner/repo"
  GITHUB_REPOSITORY?: string

  GITHUB_TOKEN?: string

  // Default: bug,sentry,automated
  BUG_ISSUE_LABELS?: string

  BUG_ISSUE_ASSIGNEES?: string

  BUG_ISSUE_TITLE_PREFIX?: string

  // Comma-separated allowed sender addresses / domains. Unset defaults to
  // Sentry's known sending domains (fail closed); "" rejects every sender;
  // "*" explicitly allows every sender.
  BUG_ALLOWED_SENDERS?: string

  GITHUB_API_BASE?: string
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    try {
      const config = parseConfig(env as Record<string, string | undefined>)

      if (
        config.targetAddress &&
        message.to.toLowerCase() !== config.targetAddress.toLowerCase()
      ) {
        console.log(
          `[bug-handler] ignoring mail to ${message.to} (expected ${config.targetAddress})`
        )
        return
      }

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

      const issue = buildIssue(parsed, config)

      // waitUntil: return promptly while the API call completes
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
      // Never re-throw: avoids an unhandled rejection in the runtime.
      console.error('[bug-handler] unexpected error:', err)
    }
  },
}
