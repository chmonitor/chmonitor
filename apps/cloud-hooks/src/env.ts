/**
 * Worker environment bindings + secrets for cloud-hooks. All values arrive as
 * strings, secrets, or bindings injected by Cloudflare. Nothing here is
 * committed — secrets are set via `wrangler secret put`, product-id vars via
 * `.env`/`--var`, and the D1/KV bindings via wrangler.toml.
 */
export interface Env {
  /** Shared billing D1 (same `chm-cloud` database the dashboard reads). */
  CHM_CLOUD_D1?: D1Database
  /**
   * Telemetry D1 (the `chm_telemetry` database apps/telemetry writes), read for
   * the DAU/WAU/MAU section of the digests. READ-ONLY here — this worker never
   * writes telemetry. Unbound → the Usage section is omitted.
   */
  CHM_TELEMETRY_DB?: D1Database
  /** KV namespace storing last-known health-probe state (transitions only). */
  CHM_HOOKS_KV?: KVNamespace

  // ── Secrets (wrangler secret put) ──────────────────────────────────────────
  POLAR_WEBHOOK_SECRET?: string
  POLAR_ACCESS_TOKEN?: string
  CLERK_SECRET_KEY?: string
  /**
   * Clerk webhook signing secret (`whsec_…`) for POST /webhooks/clerk. Verifies
   * inbound Clerk lifecycle events (Svix HMAC-SHA256). Unset → the Clerk
   * endpoint replies 501 and no lifecycle notifications are sent (no crash).
   */
  CLERK_WEBHOOK_SECRET?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  /**
   * GitHub PAT with `issues:write` on the target repo, used to file a GitHub
   * issue per NEW Cloudflare Worker exception fingerprint. Fallback when the
   * GitHub App creds below are unset. No auth at all → the exception-scan
   * capability is disabled (no crash).
   */
  GITHUB_TOKEN?: string
  /**
   * GitHub App id (the `duyetbot` app). With `GH_APP_PRIVATE_KEY`, exception
   * issues are filed as the App (installation token) instead of a PAT — App
   * creds take precedence over `GITHUB_TOKEN`. The App needs **Issues: Read &
   * write** and must be installed on the target repo.
   */
  GH_APP_ID?: string
  /**
   * GitHub App private key as a **PKCS#8** PEM (`-----BEGIN PRIVATE KEY-----`).
   * Escaped `\n` newlines are handled. A PKCS#1 key (`BEGIN RSA PRIVATE KEY`,
   * GitHub's default download) fails with a clear "convert with
   * `openssl pkcs8 -topk8`" message — convert it once before setting.
   */
  GH_APP_PRIVATE_KEY?: string
  /**
   * Optional GitHub App installation id. Unset → resolved once from the repo
   * (`GET /repos/{owner}/{repo}/installation`) and cached in `CHM_HOOKS_KV`.
   */
  GH_APP_INSTALLATION_ID?: string
  /**
   * Cloudflare API token with **Account → Workers Observability → Read** (the
   * Telemetry query API). Used to pull recent Worker exceptions. Unset → the
   * exception-scan capability is disabled.
   */
  CF_OBSERVABILITY_API_TOKEN?: string

  // ── Non-secret config ──────────────────────────────────────────────────────
  /** sandbox | production — selects the Polar API host for re-key + checkout. */
  CHM_POLAR_SERVER?: string
  /**
   * Origin Polar redirects to after a paid license checkout. Default
   * `https://chmonitor.dev`. Must stay a public landing origin — Polar
   * substitutes `{CHECKOUT_ID}` on the success URL.
   */
  CHM_LICENSE_SUCCESS_ORIGIN?: string
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
  /**
   * Labels whose new issues the watch stays quiet about, comma-separated.
   * Default `cloudflare-exception` — the exception scan already announces the
   * issues it files, so without this the operator is told twice.
   */
  CHM_ISSUE_WATCH_EXCLUDE_LABELS?: string
  /** Max new issues announced per ops sweep. Default `10`; the rest defer to the next run. */
  CHM_ISSUE_WATCH_MAX_PER_RUN?: string

  // Polar self-host license product ids (CHM_POLAR_LICENSE_*).
  CHM_POLAR_LICENSE_TEAM_YEARLY?: string
  CHM_POLAR_LICENSE_TEAM_LIFETIME?: string
  CHM_POLAR_LICENSE_UNLIMITED_YEARLY?: string
  CHM_POLAR_LICENSE_UNLIMITED_LIFETIME?: string

  [key: string]: unknown
}
