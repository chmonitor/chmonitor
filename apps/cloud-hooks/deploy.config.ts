// Deploy manifest for scripts/deploy-worker.ts — declares which env vars and
// secrets this worker needs so the unified deploy script never guesses.
//
// Non-secret vars come from apps/dashboard/.env.production(+.env.preview) —
// same product→plan mapping the dashboard uses, so both Workers stay in sync.
// '*' suffix wildcard-matches every key with that prefix.
export default {
  vars: ['CHM_POLAR_SERVER', 'CHM_POLAR_PRODUCT_*'],
  secrets: [
    'POLAR_WEBHOOK_SECRET',
    'POLAR_ACCESS_TOKEN',
    'CLERK_SECRET_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    // Added by the health-probes follow-up (plans/103); missing values are
    // skipped with a warning, not a hard failure, until those probes ship.
    'GITHUB_TOKEN',
    'CF_OBSERVABILITY_API_TOKEN',
  ],
}
