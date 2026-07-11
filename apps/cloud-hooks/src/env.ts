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
  HOOKS_KV?: KVNamespace

  // ── Secrets (wrangler secret put) ──────────────────────────────────────────
  POLAR_WEBHOOK_SECRET?: string
  POLAR_ACCESS_TOKEN?: string
  CLERK_SECRET_KEY?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string

  // ── Non-secret config ──────────────────────────────────────────────────────
  /** sandbox | production — selects the Polar API host for re-key calls. */
  CHM_POLAR_SERVER?: string

  // Polar product ids per plan/period (CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>). Same
  // names the dashboard uses so both Workers map products identically.
  CHM_POLAR_PRODUCT_FREE_MONTHLY?: string
  CHM_POLAR_PRODUCT_PRO_MONTHLY?: string
  CHM_POLAR_PRODUCT_PRO_YEARLY?: string
  CHM_POLAR_PRODUCT_MAX_MONTHLY?: string
  CHM_POLAR_PRODUCT_MAX_YEARLY?: string

  [key: string]: unknown
}
