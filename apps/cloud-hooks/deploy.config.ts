// Deploy manifest for scripts/deploy-worker.ts — declares which env vars and
// secrets this worker needs so the unified deploy script never guesses.
//
// Non-secret vars come from apps/dashboard/.env.production(+.env.preview) —
// same product→plan mapping the dashboard uses, so both Workers stay in sync.
// '*' suffix wildcard-matches every key with that prefix.
export default {
  vars: [
    'CHM_POLAR_SERVER',
    'CHM_POLAR_PRODUCT_*',
    // Exception-scan config (see apps/cloud-hooks/wrangler.toml header).
    'CF_ACCOUNT_ID',
    'GITHUB_REPOSITORY',
    'CHM_EXCEPTION_ISSUE_LABELS',
    'CHM_EXCEPTION_MAX_ISSUES_PER_RUN',
    'CHM_EXCEPTION_SCRIPTS',
    // Optional GitHub App installation id (non-secret); unset → resolved from
    // the repo and cached in KV.
    'GH_APP_INSTALLATION_ID',
  ],
  secrets: [
    'POLAR_WEBHOOK_SECRET',
    'POLAR_ACCESS_TOKEN',
    'CLERK_SECRET_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    // Files a GitHub issue per new Worker exception / reads exceptions via the
    // Telemetry query API (see apps/cloud-hooks/wrangler.toml header); missing
    // values are skipped with a warning, not a hard failure.
    'GITHUB_TOKEN',
    'CF_OBSERVABILITY_API_TOKEN',
    // GitHub App auth (the `duyetbot` app) — takes precedence over GITHUB_TOKEN
    // when both are set. GH_APP_PRIVATE_KEY must be a PKCS#8 PEM.
    'GH_APP_ID',
    'GH_APP_PRIVATE_KEY',
  ],
}
