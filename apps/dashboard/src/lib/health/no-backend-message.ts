/**
 * One wording for "this alert-settings store has no metadata database".
 *
 * Names the self-hosted env var first (`DATABASE_URL`), then the Cloudflare D1
 * binding. Every `lib/health` store resolves through `getHealthDb`, which
 * accepts Postgres, so the `DATABASE_URL` claim holds for all of them.
 */

export function noBackendMessage(
  feature: string,
  d1Bindings = 'CHM_CLOUD_D1'
): string {
  return `No alert state backend configured. ${feature} requires a Postgres DATABASE_URL (self-hosted) or, on Cloudflare Workers, a D1 binding (${d1Bindings}).`
}
