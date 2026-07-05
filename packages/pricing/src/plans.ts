/**
 * Billing plans — THE single source of truth for cloud (SaaS) tiers.
 *
 * This zero-dependency package is consumed by BOTH surfaces so they can never
 * drift:
 * - `apps/dashboard` (`lib/billing/plans.ts` re-exports this) — server-side
 *   entitlement / limit checks and the in-app billing page.
 * - `apps/landing` (`src/data/pricing.ts` derives its view models from this) —
 *   the marketing pricing cards + comparison matrix.
 *
 * OSS/self-host never reads this: when auth is `none` everything is authorized
 * and unlimited, so plans are inert. Activates only under cloud mode + Clerk +
 * billing config.
 *
 * Keep this module pure data + pure functions (no framework / app imports) so
 * the standalone Astro landing app can import it without dragging deps in.
 *
 * ── Pricing strategy (see docs/knowledge + plan) ──────────────────────────────
 * Deliberately below-market for early access: ~$10/host vs Datadog ~$15–23/host
 * and pganalyze ~$100–149/host. Raise toward ~$49 Pro / ~$149 Max at GA and
 * grandfather early-access accounts. Yearly = 10× monthly (≈2 months free).
 */

export const PLAN_IDS = ['free', 'pro', 'max', 'enterprise'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/**
 * Capabilities a plan unlocks (the benefit ladder). Self-contained on purpose —
 * mapped to the real gates (`lib/edition` ENTERPRISE_FEATURES + feature-permissions)
 * during enforcement (M3), so this stays presentation-friendly and stable.
 */
export type PlanCapability =
  | 'core_monitoring' // queries, merges, replication, cluster — in every tier
  | 'ai_agent'
  | 'ai_insights_scheduled'
  | 'alerting_basic'
  | 'alerting_advanced' // + Slack/PagerDuty
  | 'data_export' // CSV/JSON export of query results & scheduled reports
  | 'anomaly_detection' // automated anomaly / regression detection
  | 'fleet_view'
  | 'custom_dashboards' // saved custom views / dashboards
  | 'webhook_integrations' // outbound webhooks for alerts & events
  | 'api_mcp_access'
  | 'sso_rbac_audit'
  | 'priority_support'

export interface Plan {
  id: PlanId
  name: string
  /** One-line positioning shown under the plan name. */
  tagline: string
  /** USD/month on monthly billing. null = custom (Enterprise) or free. */
  priceMonthlyUsd: number | null
  /** USD/year on annual billing (10× monthly ⇒ ~2 months free). null = custom/free. */
  priceYearlyUsd: number | null
  seats: number | null // null = custom/unlimited
  hosts: number | null // null = custom/unlimited; the INCLUDED allowance
  /**
   * Overage policy once `hosts` is reached: `usdPer` USD/month per extra host
   * kept past the included allowance. null = hard cap (Free — no expansion;
   * Enterprise — moot, `hosts` is already unlimited). Paid tiers (Pro/Max) set
   * this so adding a host past the included count soft-caps (allowed, billed)
   * instead of hard-blocking — the GA land-and-expand lever.
   */
  hostOverage: { usdPer: number } | null
  /** Monthly LLM spend allowance in USD. null = BYOK / unlimited (Enterprise). */
  aiMonthlyUsdBudget: number | null
  /**
   * AI agent messages included per day — the headline AI meter on every tier.
   * Free is a hard daily cap (no overage). Paid tiers (Pro/Max) treat this as
   * the INCLUDED allowance and bill overage past it (see `aiOverage`). null =
   * unlimited (Enterprise BYOK).
   */
  aiRequestsPerDay: number | null
  /**
   * Overage policy once the daily included messages are used up: `usdPer` USD
   * buys another `messages` block. null = no overage (Free hard-caps; Enterprise
   * is unlimited). NOTE: metered overage billing is not wired yet — this is the
   * published policy that the soft daily cap and pricing copy reflect.
   */
  aiOverage: { usdPer: number; messages: number } | null
  /** Max number of saved alert rules. 0 = none, null = unlimited (Enterprise). */
  alertRules: number | null
  /** History retention for conversations / insights. null = custom. */
  retentionDays: number | null
  capabilities: PlanCapability[]
  /** Human-facing bullet list for the pricing card. */
  highlights: string[]
  /** null until Polar products exist (M3). */
  polarProductId?: { monthly: string; yearly: string } | null
}

const CORE: PlanCapability[] = ['core_monitoring']

export const BILLING_PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Try the hosted dashboard, no setup.',
    priceMonthlyUsd: 0,
    priceYearlyUsd: 0,
    seats: 1,
    hosts: 1,
    hostOverage: null, // hard cap — no expansion on Free
    aiMonthlyUsdBudget: 0.5,
    aiRequestsPerDay: 5,
    aiOverage: null,
    alertRules: 0,
    retentionDays: 7,
    capabilities: [...CORE, 'ai_agent'],
    highlights: [
      '1 ClickHouse host, 1 seat',
      'Full monitoring dashboard',
      'AI agent — 5 messages / day',
      '7-day conversation & insights history',
      'Community support',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For a small team running a few clusters.',
    priceMonthlyUsd: 29,
    priceYearlyUsd: 290,
    seats: 3,
    hosts: 3,
    hostOverage: { usdPer: 15 }, // soft-cap: 4th+ host bills $15/mo each
    aiMonthlyUsdBudget: 5,
    aiRequestsPerDay: 100,
    aiOverage: { usdPer: 5, messages: 2000 },
    alertRules: 10,
    retentionDays: 30,
    capabilities: [
      ...CORE,
      'ai_agent',
      'ai_insights_scheduled',
      'alerting_basic',
      'data_export',
      'anomaly_detection',
    ],
    highlights: [
      'Everything in Free',
      '3 hosts included, 3 seats — extra hosts $15/mo each',
      'AI agent — 100 messages / day, then $5 / 2,000',
      'Scheduled AI Insights',
      'Basic alerting — up to 10 rules',
      'Anomaly detection + data export',
      '30-day conversation & insights history',
      'Email support',
    ],
  },
  max: {
    id: 'max',
    name: 'Max',
    tagline: 'For teams operating a fleet of clusters.',
    priceMonthlyUsd: 99,
    priceYearlyUsd: 990,
    seats: 10,
    hosts: 10,
    hostOverage: { usdPer: 19 }, // soft-cap: 11th+ host bills $19/mo each
    aiMonthlyUsdBudget: 20,
    aiRequestsPerDay: 1000,
    aiOverage: { usdPer: 5, messages: 2000 },
    alertRules: 50,
    retentionDays: 90,
    capabilities: [
      ...CORE,
      'ai_agent',
      'ai_insights_scheduled',
      'alerting_advanced',
      'data_export',
      'anomaly_detection',
      'fleet_view',
      'custom_dashboards',
      'webhook_integrations',
      'api_mcp_access',
      'priority_support',
    ],
    highlights: [
      'Everything in Pro',
      '10 hosts included, 10 seats — extra hosts $19/mo each',
      'AI agent — 1,000 messages / day, then $5 / 2,000',
      'Fleet view + advanced alerting (Slack, PagerDuty)',
      'Custom dashboards + webhook integrations',
      'API / MCP access',
      '90-day conversation & insights history',
      'Priority support',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For organisations with security & scale needs.',
    priceMonthlyUsd: null,
    priceYearlyUsd: null,
    seats: null,
    hosts: null,
    hostOverage: null, // moot — hosts is already unlimited
    aiMonthlyUsdBudget: null, // BYOK / unlimited
    aiRequestsPerDay: null,
    aiOverage: null, // BYOK — unlimited, no metered overage
    alertRules: null, // unlimited
    retentionDays: null,
    capabilities: [
      ...CORE,
      'ai_agent',
      'ai_insights_scheduled',
      'alerting_advanced',
      'data_export',
      'anomaly_detection',
      'fleet_view',
      'custom_dashboards',
      'webhook_integrations',
      'api_mcp_access',
      'sso_rbac_audit',
      'priority_support',
    ],
    highlights: [
      'Everything in Max',
      'Dedicated single-tenant instance',
      'Unlimited hosts & seats',
      'Bring-your-own LLM key (BYOK)',
      'SSO / SAML, RBAC, audit logs',
      'Custom retention',
      'SLA & dedicated support',
    ],
  },
}

/** Ordered list for rendering (free → enterprise). */
export const BILLING_PLAN_LIST: Plan[] = PLAN_IDS.map((id) => BILLING_PLANS[id])

export function getPlan(id: PlanId): Plan {
  return BILLING_PLANS[id]
}

/** Whether a plan grants a capability. Inert for OSS (callers gate on billing). */
export function planHasCapability(id: PlanId, cap: PlanCapability): boolean {
  return BILLING_PLANS[id].capabilities.includes(cap)
}

/**
 * Effective monthly price for a billing period. Yearly returns the per-month
 * equivalent (priceYearly / 12) for "$X/mo billed yearly" display.
 */
export function monthlyEquivalentUsd(
  plan: Plan,
  period: 'monthly' | 'yearly'
): number | null {
  if (period === 'monthly') return plan.priceMonthlyUsd
  if (plan.priceYearlyUsd == null) return null
  return Math.round((plan.priceYearlyUsd / 12) * 100) / 100
}

/** Months-free saved on yearly vs monthly (for the "save N months" badge). */
export function yearlyMonthsFree(plan: Plan): number | null {
  if (!plan.priceMonthlyUsd || !plan.priceYearlyUsd) return null
  const monthsPaid = plan.priceYearlyUsd / plan.priceMonthlyUsd
  return Math.round((12 - monthsPaid) * 10) / 10
}
