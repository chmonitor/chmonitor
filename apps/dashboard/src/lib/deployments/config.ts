/**
 * GitHub deployment webhook — runtime config.
 *
 * GITHUB_WEBHOOK_SECRET (secret) — signing secret used to verify inbound
 * `deployment` / `deployment_status` webhooks configured on a GitHub repo
 * (Settings → Webhooks). Single global secret (self-host / single-org first,
 * matching plans/45-github-deploy-correlation.md's resolved open question);
 * per-org secrets are a follow-up if Clerk orgs each need their own GitHub
 * webhook. Mirror of getClerkWebhookSecret() in billing/clerk-webhook-config.ts.
 */

function readEnv(key: string): string | undefined {
  const v = process.env[key]
  return v === undefined || v === '' ? undefined : v
}

export function getGithubWebhookSecret(): string | undefined {
  return readEnv('GITHUB_WEBHOOK_SECRET')
}

/**
 * Single-tenant scope for stored deployments. `owner_scope` exists in the
 * `github_deployments` schema for future multi-tenant mapping (e.g. per-org
 * GitHub App installs), but with one global webhook secret there is only one
 * logical scope today — all ingested deployments share it, and the overlay
 * reads it back the same way.
 */
export const DEFAULT_DEPLOYMENT_SCOPE = 'default'
