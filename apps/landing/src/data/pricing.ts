/**
 * Landing-side pricing VIEW MODELS — derived from the shared @chm/pricing
 * package (the single source of truth, also used by the dashboard), so the
 * marketing cards / comparison matrix can never drift from the real plans.
 *
 * Numbers, limits, capabilities and the AI-usage / retention strings all come
 * from @chm/pricing. Only pure-presentation choices live here: the "Early
 * access" badge, CTA links, support-tier labels, and the FAQ copy.
 */

import {
  BILLING_PLAN_LIST,
  type Plan,
  type PlanCapability,
  type PlanId,
  planAiUsage,
  planAlertRules,
  planHasCapability,
  planHosts,
  planRetention,
  planSeats,
  yearlyMonthsFree,
} from '@chm/pricing'

export interface PricingTier {
  name: string
  badge?: { label: string; cls: string }
  highlight?: boolean
  monthly: number | null // null = custom
  yearlyTotal: number | null
  yearlyPerMo: number | null
  /** Months free on annual billing vs monthly, from @chm/pricing (null = no paid yearly). */
  yearlyMonthsFree: number | null
  tagline: string
  rows: string[]
  cta: { label: string; href: string; primary?: boolean }
}

const DASH = 'https://dash.chmonitor.dev'

/** Pure-presentation per-plan bits not expressed in @chm/pricing. */
const PRESENTATION: Record<
  PlanId,
  { badge?: PricingTier['badge']; highlight?: boolean; cta: PricingTier['cta'] }
> = {
  free: {
    badge: { label: 'Early access', cls: 'ptag-beta' },
    cta: { label: 'Get started', href: DASH, primary: true },
  },
  pro: {
    cta: { label: 'Get started', href: DASH, primary: true },
  },
  max: { cta: { label: 'Get started', href: DASH } },
  enterprise: {
    cta: { label: 'Contact us', href: 'mailto:hello@chmonitor.dev' },
  },
}

/** Per-month equivalent of the yearly price, rounded to a whole dollar. */
function yearlyPerMo(plan: Plan): number | null {
  if (plan.priceYearlyUsd == null) return null
  return Math.round(plan.priceYearlyUsd / 12)
}

export const pricingTiers: PricingTier[] = BILLING_PLAN_LIST.map((plan) => ({
  name: plan.name,
  badge: PRESENTATION[plan.id].badge,
  highlight: PRESENTATION[plan.id].highlight,
  monthly: plan.priceMonthlyUsd,
  yearlyTotal: plan.priceYearlyUsd,
  yearlyPerMo: yearlyPerMo(plan),
  yearlyMonthsFree: yearlyMonthsFree(plan),
  tagline: plan.tagline,
  rows: plan.highlights,
  cta: PRESENTATION[plan.id].cta,
}))

/** Render a "N month(s)" phrase (plural-aware) for annual-savings copy. */
export function monthsFreeText(months: number): string {
  const n = Math.round(months * 10) / 10
  return `${n} month${n === 1 ? '' : 's'}`
}

/**
 * Headline "months free" for annual billing, derived from @chm/pricing so it
 * can never drift from the real yearly discount. Paid plans share the same
 * 10×-monthly ratio; we surface the largest saving as the toggle figure.
 */
export const yearlyMonthsFreeValue: number = Math.max(
  0,
  ...pricingTiers.map((t) => t.yearlyMonthsFree ?? 0)
)

/** A comparison cell: true (✓), false (—), or a literal string. */
export type CompareCell = boolean | string

export interface CompareRow {
  label: string
  /** [Free, Pro, Max, Enterprise] */
  values: [CompareCell, CompareCell, CompareCell, CompareCell]
}

export interface CompareGroup {
  group: string
  rows: CompareRow[]
}

/** Plan column order for the matrix header (derived from the canonical order). */
export const compareColumns = BILLING_PLAN_LIST.map((p) => p.name) as [
  string,
  string,
  string,
  string,
]

/** Map a per-plan function across the 4 tiers into a comparison tuple. */
function across(fn: (plan: Plan) => CompareCell): CompareRow['values'] {
  return BILLING_PLAN_LIST.map(fn) as CompareRow['values']
}

/** ✓/— tuple for a capability flag. */
function capRow(cap: PlanCapability): CompareRow['values'] {
  return across((plan) => planHasCapability(plan.id, cap))
}

/** Support tier is presentation-only (not a single capability flag). */
const SUPPORT: Record<PlanId, string> = {
  free: 'Community',
  pro: 'Email',
  max: 'Priority',
  enterprise: 'SLA + dedicated',
}

export const compareGroups: CompareGroup[] = [
  {
    group: 'Limits',
    rows: [
      { label: 'ClickHouse hosts', values: across(planHosts) },
      { label: 'Team seats', values: across(planSeats) },
      { label: 'Alert rules', values: across(planAlertRules) },
      {
        label: 'Conversation & insights history',
        values: across(planRetention),
      },
      { label: 'AI usage', values: across(planAiUsage) },
    ],
  },
  {
    group: 'Features',
    rows: [
      { label: 'Full monitoring dashboard', values: capRow('core_monitoring') },
      { label: 'AI agent', values: capRow('ai_agent') },
      {
        label: 'Scheduled AI Insights',
        values: capRow('ai_insights_scheduled'),
      },
      {
        label: 'Alerting',
        values: across((plan) =>
          planHasCapability(plan.id, 'alerting_advanced')
            ? 'Advanced'
            : planHasCapability(plan.id, 'alerting_basic')
              ? 'Basic'
              : false
        ),
      },
      { label: 'Anomaly detection', values: capRow('anomaly_detection') },
      { label: 'Data export & reports', values: capRow('data_export') },
      { label: 'Custom dashboards', values: capRow('custom_dashboards') },
      { label: 'Webhook integrations', values: capRow('webhook_integrations') },
      { label: 'Fleet view', values: capRow('fleet_view') },
      { label: 'API / MCP access', values: capRow('api_mcp_access') },
      {
        label: 'SSO / SAML, RBAC, audit logs',
        values: capRow('sso_rbac_audit'),
      },
      { label: 'Support', values: across((plan) => SUPPORT[plan.id]) },
    ],
  },
]

export interface PricingFaq {
  q: string
  a: string
}

export const pricingFaqs: PricingFaq[] = [
  {
    q: 'Is self-hosting really free?',
    a: 'Yes. chmonitor is open source under GPL-3.0. Run it on your own infrastructure (Docker, Cloudflare Workers, Kubernetes) with every feature, unlimited clusters, and your data never leaving your network — at no cost, forever.',
  },
  {
    q: "What's a “host”?",
    a: 'A host is a single ClickHouse connection (one cluster endpoint). Your plan caps how many hosts you can connect to the hosted dashboard at once. Self-hosting has no host limit.',
  },
  {
    q: 'How does AI usage metering work?',
    a: 'Every plan includes a daily allowance of AI agent messages: Free 5 messages / day, Pro 100 / day, Max 1,000 / day. On Pro and Max, usage past the daily allowance is billed as overage at $5 per 2,000 messages. Enterprise brings its own LLM key (BYOK) for unlimited usage.',
  },
  {
    q: 'What happens when I hit a plan limit?',
    a: 'Limits fail gracefully — you keep full access to everything already in use and see a clear prompt to upgrade. Nothing is deleted or interrupted; you simply cannot add beyond the cap until you upgrade.',
  },
  {
    q: 'Can I change plans or cancel anytime?',
    a: 'Yes. Upgrade, downgrade, or cancel from the in-app billing portal at any time. Paid access continues until the end of the period you have already paid for, then cleanly returns to Free.',
  },
  {
    q: 'Is annual billing cheaper?',
    a: 'Yes — annual billing is 10× the monthly price, so you get roughly two months free versus paying month to month.',
  },
  {
    q: 'Do you read or write my data?',
    a: 'chmonitor only reads from ClickHouse system tables and never writes to your data. Connect with a read-only SELECT user for maximum safety.',
  },
]
