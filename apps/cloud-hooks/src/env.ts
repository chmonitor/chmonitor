/**
 * Worker environment bindings + secrets for cloud-hooks. All values arrive as
 * strings, secrets, or bindings injected by Cloudflare. Nothing here is
 * committed — secrets are set via `wrangler secret put`, product-id vars via
 * `.env`/`--var`, and the D1/KV bindings via wrangler.toml.
 */
export interface Env {
  /** Shared billing D1 (same `chm-cloud` database the dashboard reads). */
  CHM_CLOUD_D1?: D1Database
  /** KV namespace storing last-known health-probe state (transitions only). */
  CHM_HOOKS_KV?: KVNamespace

  // ── Secrets (wrangler secret put) ──────────────────────────────────────────
  POLAR_WEBHOOK_SECRET?: string
  POLAR_ACCESS_TOKEN?: string
  CLERK_SECRET_KEY?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  /**
   * GitHub token (PAT/App token with `issues:write` on the target repo) used to
   * file a GitHub issue per NEW Cloudflare Worker exception fingerprint. Unset →
   * the exception-scan capability is disabled (no crash).
   */
  GITHUB_TOKEN?: string
  /**
   * Cloudflare API token with **Account → Workers Observability → Read** (the
   * Telemetry query API). Used to pull recent Worker exceptions. Unset → the
   * exception-scan capability is disabled.
   */
  CF_OBSERVABILITY_API_TOKEN?: string

  // ── Non-secret config ──────────────────────────────────────────────────────
  /** sandbox | production — selects the Polar API host for re-key calls. */
  CHM_POLAR_SERVER?: string
  /** Cloudflare account id — required (with CF_OBSERVABILITY_API_TOKEN) to query exceptions. */
  CF_ACCOUNT_ID?: string
  /** `owner/repo` issues are filed in. Defaults to `chmonitor/chmonitor`. */
  GITHUB_REPOSITORY?: string
  /** Comma-separated labels for exception issues. Default `bug,cloudflare-exception`. */
  CHM_EXCEPTION_ISSUE_LABELS?: string
  /** Max issues created per scan run (rate cap). Default `5`. */
  CHM_EXCEPTION_MAX_ISSUES_PER_RUN?: string
  /** Comma-separated Worker script names to scan. Default `chmonitor-dash,chmonitor-hooks`. */
  CHM_EXCEPTION_SCRIPTS?: string

  // Polar product ids per plan/period (CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>). Same
  // names the dashboard uses so both Workers map products identically.
  CHM_POLAR_PRODUCT_FREE_MONTHLY?: string
  CHM_POLAR_PRODUCT_PRO_MONTHLY?: string
  CHM_POLAR_PRODUCT_PRO_YEARLY?: string
  CHM_POLAR_PRODUCT_MAX_MONTHLY?: string
  CHM_POLAR_PRODUCT_MAX_YEARLY?: string

  [key: string]: unknown
}
