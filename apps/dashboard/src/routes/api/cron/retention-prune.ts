/**
 * Retention Prune Cron Endpoint — GET /api/cron/retention-prune
 *
 * Invoked by the Cloudflare Cron Trigger (see wrangler.toml `[triggers] crons`)
 * once daily at 03:00 UTC. The @cloudflare/vite-plugin worker routes scheduled
 * events to the fetch handler, so the cron hits this GET route.
 *
 * Hard-deletes conversation rows in CHM_CLOUD_D1 that are older than each
 * user's plan retention window. Iterates over all distinct user_ids, resolves
 * their effective billing plan via resolveRetentionPlanForUser (the BILLING
 * OWNER's plan — user id PLUS every Clerk org they belong to, most generous
 * wins — NOT the bare user_id, which would miss org-owned paid subscriptions and
 * wrongly delete data on 30/90-day plans), computes the cutoff with
 * retentionCutoffMs, and issues a DELETE WHERE updated_at < cutoff. Users on
 * enterprise (retentionDays: null) are skipped (unlimited retention). If owner
 * resolution fails (e.g. Clerk enumeration error) the user is skipped rather
 * than pruned, so a transient failure can never cause silent deletion.
 *
 * Guarded by a shared secret (CRON_SECRET) supplied via the `Authorization:
 * Bearer <secret>` header only. Returns 401 on mismatch.
 *
 * CRON_SECRET is REQUIRED for this route: when it is unset/empty the endpoint
 * FAILS CLOSED with HTTP 503 (it does NOT run). This is a destructive endpoint
 * (it DELETEs conversation rows), and the platform routes Cloudflare scheduled
 * events to the fetch handler as a plain GET with no distinguishable, trusted
 * in-request signal, so there is no way to safely allow an "internal cron only"
 * path — an unauthenticated caller would otherwise trigger deletion. Operators
 * MUST configure CRON_SECRET and pass it from their scheduler (see docs).
 *
 * Graceful no-op when CHM_CLOUD_D1 is not bound (OSS / non-CF environments).
 */

import { createFileRoute } from '@tanstack/react-router'

import { error, log, warn } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'
import { BILLING_PLANS, type Plan } from '@chm/pricing'
import { retentionCutoffMs } from '@/lib/billing/entitlements'
import { resolveRetentionPlanForUser } from '@/lib/billing/retention-owner'
import { authorizeCronRequest } from '@/lib/cron/authorize-cron'
import { mapWithConcurrency } from '@/lib/utils/map-with-concurrency'

/** Max users pruned in parallel — bounds Clerk/billing/D1 subrequests in flight. */
const PRUNE_CONCURRENCY = 5

/**
 * The newest cutoff any finite-retention plan can produce (shortest window).
 * A user with no conversation older than this cannot have anything to prune.
 */
function shortestRetentionCutoffMs(): number {
  const days = Object.values(BILLING_PLANS)
    .map((p) => p.retentionDays)
    .filter((d): d is number => d != null)
  return Date.now() - Math.min(...days) * 24 * 60 * 60 * 1000
}

async function handler(request: Request): Promise<Response> {
  const denied = authorizeCronRequest(request, 'retention-prune')
  if (denied) {
    if (denied.status === 503) {
      warn(
        '[GET /api/cron/retention-prune] CRON_SECRET not configured — refusing (503). Set CRON_SECRET to enable this endpoint.'
      )
    }
    return denied
  }

  // Graceful no-op: D1 not bound (OSS / local dev / non-CF environment)
  let db: D1Database | null = null
  try {
    db = getPlatformBindings().getD1Database('CHM_CLOUD_D1')
  } catch {
    // Not in Cloudflare environment
  }

  if (!db) {
    log('[GET /api/cron/retention-prune] CHM_CLOUD_D1 not bound — no-op')
    return Response.json({ skipped: true, reason: 'D1 not bound' })
  }

  try {
    // Only users with a conversation older than the SHORTEST plan cutoff can
    // have anything to prune; skip the rest so they cost no Clerk/billing calls.
    const shortestCutoff = shortestRetentionCutoffMs()
    const userResult = await db
      .prepare(
        'SELECT user_id FROM conversations GROUP BY user_id HAVING MIN(updated_at) < ?1'
      )
      .bind(shortestCutoff)
      .all<{ user_id: string }>()

    const userIds = (userResult.results ?? []).map((r) => r.user_id)
    log(`[GET /api/cron/retention-prune] Processing ${userIds.length} users`)

    let totalDeleted = 0
    let usersSkipped = 0
    let errors = 0
    const planCache = new Map<string, Promise<Plan>>()

    await mapWithConcurrency(userIds, PRUNE_CONCURRENCY, async (userId) => {
      try {
        // Resolve the BILLING OWNER's plan (org-aware), not the bare user_id,
        // so prune matches what the conversations read-filter displays.
        const plan = await resolveRetentionPlanForUser(userId, planCache)
        const cutoff = retentionCutoffMs(plan)

        // null = unlimited (enterprise) — nothing to prune
        if (cutoff == null) {
          usersSkipped += 1
          return
        }

        const deleteResult = await db
          .prepare(
            'DELETE FROM conversations WHERE user_id = ?1 AND updated_at < ?2'
          )
          .bind(userId, cutoff)
          .run()

        const deleted = deleteResult.meta?.changes ?? 0
        totalDeleted += deleted

        if (deleted > 0) {
          log(
            `[GET /api/cron/retention-prune] Pruned ${deleted} conversations for user ${userId} (plan=${plan.id}, cutoff=${cutoff})`
          )
        }
      } catch (err) {
        errors += 1
        error(
          `[GET /api/cron/retention-prune] Failed to prune user ${userId}`,
          err as Error
        )
      }
    })

    const summary = {
      usersProcessed: userIds.length,
      usersSkipped,
      totalDeleted,
      errors,
    }

    log('[GET /api/cron/retention-prune] Complete', summary)
    return Response.json(summary, { status: 200 })
  } catch (err) {
    error('[GET /api/cron/retention-prune] Prune failed', err as Error)
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Retention prune failed',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/cron/retention-prune')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})

export { handler as __handlerForTests }
