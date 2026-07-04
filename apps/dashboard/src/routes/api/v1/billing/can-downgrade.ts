/**
 * POST /api/v1/billing/can-downgrade — pre-flight check before sending a user
 * to the Polar portal to change to a lower (or different) plan.
 *
 * Body: { targetPlanId: PlanId }
 * Returns: { ok: boolean; exceeded: ExceededLimit[] }
 *
 * Compares the owner's CURRENT usage against the TARGET plan's caps, using the
 * exact same consumption numbers as GET /api/v1/billing/usage — both routes
 * call {@link resolveOwnerUsage} (`lib/billing/owner-usage.ts`) so "current
 * usage" can never drift between the usage card and this check. Each metric is
 * checked through the same `check*` entitlement helpers
 * (`lib/billing/entitlements.ts`) `usage.ts` uses, just evaluated against the
 * TARGET plan instead of the current one.
 *
 * Honest paywalls: a metric only reaches `exceeded` when it is BOTH (a)
 * numerically over the target plan's cap and (b) classified `enforced` in
 * `lib/billing/plan-enforcement.ts` (`LIMIT_ENFORCEMENT`) — a `deferred` limit
 * must never manufacture a warning. See the metric notes below `buildExceeded`
 * for why `hosts`, `aiRequestsPerDay`, and `retentionDays` stay in the
 * `ExceededMetric` type but are only conditionally (`hosts`) or never
 * (`aiRequestsPerDay` / `retentionDays`) actually populated.
 *
 * The exceeded decision uses strict `used > targetLimit` (NOT the entitlement
 * helpers' `.allowed`, which answers "room for one more" and would false-warn
 * on an exact fit, e.g. 3 hosts moving to a 3-host plan).
 *
 * Fails open: ANY error resolving the billing owner, plan, or usage — most
 * commonly no Clerk configured (self-hosted/OSS) — returns
 * `{ ok: true, exceeded: [] }`. OSS has nothing to protect, and this route must
 * never block or throw for a self-hosted install.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { LimitCheck } from '@/lib/billing/entitlements'
import type { LimitKey } from '@/lib/billing/plan-enforcement'
import type { PlanId } from '@/lib/billing/plans'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkHostLimit,
  checkSeatLimit,
  limitMessage,
} from '@/lib/billing/entitlements'
import { resolveOwnerUsage } from '@/lib/billing/owner-usage'
import { LIMIT_ENFORCEMENT } from '@/lib/billing/plan-enforcement'
import { getPlan, PLAN_IDS } from '@/lib/billing/plans'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'

const ROUTE = { route: '/api/v1/billing/can-downgrade', method: 'POST' }

/**
 * Metrics `can-downgrade` is capable of reporting. Only `seats`, and `hosts`
 * when the target plan hard-caps, are ever actually populated in `exceeded`
 * today:
 * - `hosts` is a SOFT cap on every plan that publishes `plan.hostOverage`
 *   (Pro/Max) — `routes/api/v1/user-connections.ts` gates host creation via
 *   `checkHostSoftCap`, which never blocks a plan with an overage policy; it
 *   only meters billable overage (`host-usage-store.ts`). Downgrading to a
 *   plan with `hostOverage` set never actually removes host access, so
 *   flagging it via the hard-cap `checkHostLimit` (`used > targetLimit`) would
 *   be the same dishonest warning this route explicitly avoids for
 *   `aiRequestsPerDay` below. `hosts` is only checked (and can only appear in
 *   `exceeded`) when the TARGET plan hard-caps (`hostOverage == null`, e.g.
 *   Free) — currently unreachable from the billing UI (its "Change to <plan>"
 *   CTA only targets Pro/Max, both soft-capped) but kept correct in case a
 *   hard-capped target ever becomes reachable.
 * - `aiRequestsPerDay` is a SOFT cap on every paid tier — `checkAiDailyLimit`
 *   returns `allowed: true` whenever the plan has `aiOverage` set (Pro/Max bill
 *   overage instead of blocking). A numeric "over" against a paid target isn't
 *   an enforced loss of access, so warning on it would be dishonest. It's also
 *   a daily-resetting counter, not a persistent-state loss like hosts/seats.
 * - `retentionDays` is enforced (see `LIMIT_ENFORCEMENT.retentionDays`) but has
 *   no "current usage" resolver anywhere in the codebase (no "oldest stored
 *   data" metric) — inventing one here would risk a warning not backed by a
 *   real, measured gate.
 * All three stay in the union so the response shape matches the spec and can
 * be extended later without a breaking type change.
 */
export type ExceededMetric =
  | 'hosts'
  | 'seats'
  | 'aiRequestsPerDay'
  | 'retentionDays'

export interface ExceededLimit {
  metric: ExceededMetric
  used: number
  targetLimit: number | null
  message: string
}

interface RequestBody {
  targetPlanId?: string
}

function isPlanId(value: unknown): value is PlanId {
  return (
    typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
  )
}

interface MetricSpec {
  key: LimitKey
  metric: ExceededMetric
  check: LimitCheck
}

/**
 * Build the `exceeded` list from a set of per-metric checks (each already
 * evaluated against the TARGET plan). A spec only contributes a warning when
 * its `LIMIT_ENFORCEMENT` status is `enforced`, the target plan actually caps
 * the metric (`limit` non-null — unlimited targets can never be exceeded), and
 * usage strictly exceeds that cap.
 */
function buildExceeded(specs: MetricSpec[]): ExceededLimit[] {
  const exceeded: ExceededLimit[] = []
  for (const spec of specs) {
    if (LIMIT_ENFORCEMENT[spec.key].status !== 'enforced') continue
    if (spec.check.limit == null) continue
    if (spec.check.used <= spec.check.limit) continue
    exceeded.push({
      metric: spec.metric,
      used: spec.check.used,
      targetLimit: spec.check.limit,
      message: limitMessage(spec.check),
    })
  }
  return exceeded
}

async function handlePost(request: Request): Promise<Response> {
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Body must be valid JSON',
      },
      400,
      ROUTE
    )
  }

  if (!isPlanId(body.targetPlanId)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: `targetPlanId must be one of: ${PLAN_IDS.join(', ')}`,
      },
      400,
      ROUTE
    )
  }
  const targetPlanId = body.targetPlanId

  // Fail-open: any owner/plan/usage resolution error (no Clerk on OSS, a Clerk
  // hiccup, etc.) means there's nothing to protect — respond ok, never throw.
  try {
    const owner = await resolveBillingOwner()
    const userId = await resolveConnectionUserId()
    const usage = await resolveOwnerUsage(owner, userId)
    const targetPlan = getPlan(targetPlanId)

    const specs: MetricSpec[] = [
      {
        key: 'seats',
        metric: 'seats',
        check: checkSeatLimit(targetPlan, usage.seatsUsed),
      },
    ]
    // Only a hard-capped target (`hostOverage == null`, e.g. Free) can actually
    // lose host access — a soft-capped target (Pro/Max) bills overage instead
    // of blocking, so it must not appear in `exceeded` (see the doc comment
    // above `ExceededMetric`).
    if (targetPlan.hostOverage == null) {
      specs.push({
        key: 'hosts',
        metric: 'hosts',
        check: checkHostLimit(targetPlan, usage.hostsUsed),
      })
    }

    const exceeded = buildExceeded(specs)

    return createSuccessResponse({ ok: exceeded.length === 0, exceeded })
  } catch {
    return createSuccessResponse({ ok: true, exceeded: [] })
  }
}

export const Route = createFileRoute('/api/v1/billing/can-downgrade')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
