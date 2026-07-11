import { CheckIcon, SparklesIcon } from 'lucide-react'

import type { KeyboardEvent, ReactNode } from 'react'
import type { Plan } from '@/lib/billing/plans'

import { Badge } from '@/components/ui/badge'
import { monthlyEquivalentUsd } from '@/lib/billing/plans'
import { cn } from '@/lib/utils'

/**
 * Shared billing UI — the single source of truth for plan cards across the
 * /billing page and the /setup onboarding plan picker, so the two surfaces stay
 * visually identical. The card is a full-height flex column with the CTA pinned
 * to the bottom (`mt-auto`), so every card's button lines up on the same
 * baseline regardless of how many feature rows it has.
 */

export type BillingPeriod = 'monthly' | 'yearly'

/** Display price (per-month equivalent) for a plan + period. */
export function formatPlanPrice(plan: Plan, period: BillingPeriod): string {
  if (plan.priceMonthlyUsd === null) return 'Custom'
  if (plan.priceMonthlyUsd === 0) return '$0'
  const v = monthlyEquivalentUsd(plan, period)
  return v === null ? 'Custom' : `$${v}`
}

/** "Popular" pill shown on the featured (Pro) card. */
export function PopularBadge() {
  return (
    <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
      <SparklesIcon className="size-3" strokeWidth={2} />
      Popular
    </span>
  )
}

interface PlanCardProps {
  plan: Plan
  period: BillingPeriod
  /** Featured visual treatment (gradient + ring + lift). Use for the Pro tier. */
  featured?: boolean
  /** Top-right slot — e.g. <PopularBadge /> or a "Current" badge. */
  badge?: ReactNode
  /** Cap the number of feature rows (the picker shows 3; billing shows all). */
  maxHighlights?: number
  /** CTA button(s), rendered in the bottom-pinned footer. */
  cta: ReactNode
  /**
   * Makes the whole card a focus/compare target (billing page: click a plan to
   * compare its limits against current usage). CTA clicks don't trigger it.
   */
  onSelect?: () => void
  /** Selected (compare) visual state — only meaningful with `onSelect`. */
  selected?: boolean
  className?: string
}

/**
 * One plan card. Fancy, generous surface; featured cards get a gradient + ring.
 * The footer is pushed to the bottom so CTAs align across a row of cards.
 */
export function PlanCard({
  plan,
  period,
  featured = false,
  badge,
  maxHighlights,
  cta,
  onSelect,
  selected = false,
  className,
}: PlanCardProps) {
  const price = formatPlanPrice(plan, period)
  const showSuffix = plan.priceMonthlyUsd != null && plan.priceMonthlyUsd > 0
  const highlights =
    maxHighlights != null
      ? plan.highlights.slice(0, maxHighlights)
      : plan.highlights

  // Whole-card select target (never a nested <button> — the CTA footer stops
  // propagation instead, so its buttons keep working without selecting).
  const selectProps = onSelect
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onSelect,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        },
        'aria-pressed': selected,
      }
    : {}

  return (
    <div
      {...selectProps}
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border bg-card p-6 shadow-sm transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-md',
        featured &&
          'border-primary/50 ring-primary/15 from-card to-primary/[0.04] dark:to-primary/[0.07] bg-gradient-to-b shadow-md ring-1',
        onSelect && 'cursor-pointer',
        selected && 'border-primary ring-primary/30 ring-2',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">{plan.name}</h3>
        {badge}
      </div>

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-bold tracking-tight tabular-nums">
          {price}
        </span>
        {showSuffix && (
          <span className="text-muted-foreground text-sm font-normal">/mo</span>
        )}
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {plan.tagline}
      </p>

      <ul className="mt-5 space-y-2.5">
        {highlights.map((h) => {
          // The first bullet on paid tiers ("Everything in Free/Pro/Max") names
          // the inherited tier — highlight it as a mini section header.
          const inherited = /^Everything in /.test(h)
          return (
            <li
              key={h}
              className={cn(
                'flex gap-2.5 text-sm',
                inherited && 'border-border/60 mb-1 border-b pb-2.5 font-medium'
              )}
            >
              <CheckIcon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  inherited ? 'text-primary' : 'text-emerald-500'
                )}
                strokeWidth={2}
              />
              <span
                className={inherited ? 'text-foreground' : 'text-foreground/90'}
              >
                {h}
              </span>
            </li>
          )
        })}
      </ul>

      <div
        className="mt-auto pt-6"
        onClick={onSelect ? (e) => e.stopPropagation() : undefined}
        onKeyDown={onSelect ? (e) => e.stopPropagation() : undefined}
      >
        <PlanBillingSummary plan={plan} period={period} />
        {cta}
      </div>
    </div>
  )
}

/**
 * Price summary shown right above the upgrade CTA. On yearly it makes the
 * discount explicit — the annualized monthly price struck through, the actual
 * yearly total, and the savings. On monthly it nudges toward yearly. Only
 * renders for paid, fixed-price tiers (Free/Enterprise have nothing to compare).
 */
function PlanBillingSummary({
  plan,
  period,
}: {
  plan: Plan
  period: BillingPeriod
}) {
  if (
    plan.priceMonthlyUsd == null ||
    plan.priceMonthlyUsd <= 0 ||
    plan.priceYearlyUsd == null
  ) {
    return null
  }
  const annualIfMonthly = plan.priceMonthlyUsd * 12
  const yearlyTotal = plan.priceYearlyUsd
  const savings = annualIfMonthly - yearlyTotal

  if (period === 'yearly') {
    return (
      <div className="bg-muted/50 mb-3 rounded-lg px-3 py-2 text-xs">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground tabular-nums line-through">
            ${annualIfMonthly}
          </span>
          <span className="text-foreground font-semibold tabular-nums">
            ${yearlyTotal}
          </span>
          <span className="text-muted-foreground">/ year</span>
        </div>
        <div className="mt-0.5 text-emerald-600 dark:text-emerald-400">
          Save ${savings} with yearly billing
        </div>
      </div>
    )
  }

  return (
    <div className="bg-muted/50 text-muted-foreground mb-3 rounded-lg px-3 py-2 text-xs">
      <span className="tabular-nums">${annualIfMonthly}</span> / year billed
      monthly · <span className="text-foreground">save ${savings}</span> with
      yearly
    </div>
  )
}

/** "Current" badge used on the user's active plan. */
export function CurrentPlanBadge() {
  return <Badge variant="secondary">Current</Badge>
}

interface BillingPeriodToggleProps {
  value: BillingPeriod
  onChange: (period: BillingPeriod) => void
  className?: string
}

/** Monthly / Yearly segmented toggle, shared by both surfaces. */
export function BillingPeriodToggle({
  value,
  onChange,
  className,
}: BillingPeriodToggleProps) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className="bg-muted inline-flex rounded-full p-1">
        {(['monthly', 'yearly'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors',
              value === p
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {p}
            {p === 'yearly' && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {' '}
                · 2 months free
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
