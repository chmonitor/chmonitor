/**
 * Plan-benefit enforcement registry — the single source of truth for *whether
 * each advertised plan benefit is actually enforced in code yet*.
 *
 * Why this exists: `@chm/pricing` advertises limits + capabilities. This registry
 * is the single source of truth for *whether each advertised benefit is actually
 * gated in code*, so the gap between "advertised" and "enforced" can never drift
 * silently (the tests in `plan-enforcement.test.ts` fail if a benefit is added
 * without a classification, or if an `enforced` claim names no gate).
 *
 * Per-tier enforcement is now LIVE for the cost/abuse-bounded benefits: host cap,
 * AI daily-message cap, org seat cap, retention pruning, and the MCP capability.
 * All gates are **fail-open for self-hosted/OSS** — owner/plan resolution throws
 * without Clerk, and every call site swallows that to leave OSS ungated (the
 * "self-hosted stays whole" invariant). Benefits still marked `deferred` either
 * lack a feature to gate (alerting) or are intentionally free during beta.
 *
 * See plans/02-plan-benefits-parity.md.
 */

import type { PlanCapability } from '@chm/pricing'

export type Enforcement =
  /** Gated in code today. `gate` names where (file / function). */
  | { status: 'enforced'; gate: string }
  /** Advertised but not gated yet (free during beta / GA roadmap). */
  | { status: 'deferred'; reason: string }
  /** Not software-gated by nature (e.g. support tier, core monitoring). */
  | { status: 'inherent' }

const BETA = 'Free during early access; gate when paid GA launches.'

/**
 * Enforcement status for every {@link PlanCapability}. The test suite asserts
 * this covers the full union — adding a capability to `@chm/pricing` without a
 * line here fails the build.
 */
export const CAPABILITY_ENFORCEMENT: Record<PlanCapability, Enforcement> = {
  core_monitoring: { status: 'inherent' },
  priority_support: { status: 'inherent' },
  ai_agent: { status: 'deferred', reason: BETA },
  ai_insights_scheduled: { status: 'deferred', reason: BETA },
  alerting_basic: {
    status: 'deferred',
    reason: 'Alerting feature not built in this app yet.',
  },
  alerting_advanced: {
    status: 'deferred',
    reason: 'Alerting feature not built in this app yet.',
  },
  data_export: { status: 'deferred', reason: BETA },
  anomaly_detection: { status: 'deferred', reason: BETA },
  fleet_view: { status: 'deferred', reason: BETA },
  custom_dashboards: { status: 'deferred', reason: BETA },
  webhook_integrations: { status: 'deferred', reason: BETA },
  api_mcp_access: {
    status: 'enforced',
    gate: 'lib/billing/plan-capability.ts requirePlanCapability — routes/api/mcp.ts POST+GET',
  },
  sso_rbac_audit: { status: 'deferred', reason: BETA },
}

/** Numeric limits advertised by every plan. */
export type LimitKey =
  | 'hosts'
  | 'hostOverage'
  | 'seats'
  | 'alertRules'
  | 'retentionDays'
  | 'aiRequestsPerDay'
  | 'aiMonthlyUsdBudget'

/**
 * Enforcement status for each numeric limit. Only the host cap is wired today.
 */
export const LIMIT_ENFORCEMENT: Record<LimitKey, Enforcement> = {
  hosts: {
    status: 'enforced',
    gate: 'routes/api/v1/user-connections.ts handlePost → checkHostSoftCap (pooled by countOwnerHosts): Free hard-caps (402), Pro/Max soft-cap (allowed past the included allowance)',
  },
  hostOverage: {
    status: 'deferred',
    reason:
      'local meter live (host-usage-store.ts recordHostOverage → host_usage_monthly, peak per owner/month, surfaced as hostOverageThisMonth/hostOverageUsd on usage.ts); Polar usage-based reporting pending product setup — do not claim billed revenue until that lands',
  },
  seats: {
    status: 'enforced',
    gate: 'routes/api/v1/org/invite.ts handlePost → preCheckSeatLimit (pre-emptive 402 before the invite is created — the ONLY entry point today is a direct call to this route; the hosted Clerk <OrganizationProfile/> widget cannot be repointed at it, see components/clerk/organization-members.tsx, so its invites still rely solely on the fallback below); routes/api/v1/webhooks/clerk.ts organizationMembership.created → checkSeatLimit (rolls back over-limit member — defense-in-depth fallback, and the ONLY gate the widget invite path currently hits)',
  },
  alertRules: {
    status: 'deferred',
    reason: 'No alert-rule create path exists yet.',
  },
  retentionDays: {
    status: 'enforced',
    gate: 'conversation list read-filter (conversation-store list sinceMs) + routes/api/cron/retention-prune.ts → retentionCutoffMs',
  },
  aiRequestsPerDay: {
    status: 'enforced',
    gate: 'routes/api/v1/agent.ts handlePost → checkAiDailyLimit (atomic reserve/release: lib/billing/ai-usage-store.ts / ai_usage_daily)',
  },
  aiMonthlyUsdBudget: {
    status: 'enforced',
    gate: 'routes/api/v1/agent.ts handlePost → checkAiBudget (blocks) + meterAiOverage → ai-usage-store.ts addAiSpend (spend accumulator: ai_usage_monthly, fed by estimatedCostUsd, gated on plan.aiOverage so Free never accrues); usage.ts surfaces aiSpentThisMonth',
  },
}
