/**
 * Conversation-store auto-migration — TanStack Start / Cloudflare no-op.
 *
 * The D1 schema is applied out-of-band at deploy time via
 * `wrangler d1 migrations apply` (the `migrations_dir` declared on the binding), so
 * the runtime path is intentionally a no-op. Callers still `await autoMigrate()`
 * before touching the store; this keeps that contract for them.
 */
export async function autoMigrate(): Promise<void> {
  // Intentionally empty — schema managed by `wrangler d1 migrations apply`.
}
