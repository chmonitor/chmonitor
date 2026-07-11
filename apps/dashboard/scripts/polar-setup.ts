/**
 * Create the Polar products for the subscribable plans (Free + paid),
 * idempotently, and print the CHM_POLAR_PRODUCT_* env lines to paste into
 * .env.production(.local).
 *
 * Usage (from repo root or apps/dashboard):
 *   POLAR_ACCESS_TOKEN=polar_oat_... CHM_POLAR_SERVER=sandbox \
 *     bun apps/dashboard/scripts/polar-setup.ts
 *
 * Prices come from BILLING_PLANS (single source of truth). Re-running matches
 * existing products by name and reuses them instead of creating duplicates.
 */

import type {
  BillingPeriod,
  SubscribablePlanId,
} from '../src/lib/billing/polar-config'

import { BILLING_PLANS } from '../src/lib/billing/plans'
import { SUBSCRIBABLE_PLAN_IDS } from '../src/lib/billing/polar-config'
import { Polar } from '@polar-sh/sdk'

const token = process.env.POLAR_ACCESS_TOKEN
if (!token) {
  console.error('POLAR_ACCESS_TOKEN is required')
  process.exit(1)
}
const server =
  process.env.CHM_POLAR_SERVER === 'production' ? 'production' : 'sandbox'

const polar = new Polar({ accessToken: token, server })

function productName(
  planId: SubscribablePlanId,
  period: BillingPeriod
): string {
  const plan = BILLING_PLANS[planId]
  // Free is a single monthly-only product, so it needs no period suffix.
  if (planId === 'free') return `chmonitor ${plan.name}`
  const label = period === 'monthly' ? 'Monthly' : 'Yearly'
  return `chmonitor ${plan.name} (${label})`
}

/** Periods to provision per plan. Free is monthly-only ($0). */
function periodsFor(planId: SubscribablePlanId): readonly BillingPeriod[] {
  return planId === 'free'
    ? (['monthly'] as const)
    : (['monthly', 'yearly'] as const)
}

function priceCents(planId: SubscribablePlanId, period: BillingPeriod): number {
  const plan = BILLING_PLANS[planId]
  const usd = period === 'monthly' ? plan.priceMonthlyUsd : plan.priceYearlyUsd
  if (usd == null) throw new Error(`No price for ${planId}/${period}`)
  return Math.round(usd * 100)
}

async function listExistingProducts(): Promise<Map<string, string>> {
  const byName = new Map<string, string>()
  const pages = await polar.products.list({ limit: 100 })
  for await (const page of pages) {
    for (const product of page.result.items) {
      byName.set(product.name, product.id)
    }
  }
  return byName
}

async function ensureProduct(
  planId: SubscribablePlanId,
  period: BillingPeriod,
  existing: Map<string, string>
): Promise<{ envKey: string; id: string }> {
  const name = productName(planId, period)
  const envKey = `CHM_POLAR_PRODUCT_${planId.toUpperCase()}_${period.toUpperCase()}`
  const found = existing.get(name)
  if (found) {
    console.log(`= reuse  ${name} → ${found}`)
    return { envKey, id: found }
  }
  // Free plan → Polar's free-amount price (no card at checkout); paid → fixed.
  const prices =
    planId === 'free'
      ? [{ amountType: 'free' as const }]
      : [
          {
            amountType: 'fixed' as const,
            priceAmount: priceCents(planId, period),
            priceCurrency: 'usd' as const,
          },
        ]
  const created = await polar.products.create({
    name,
    recurringInterval: period === 'monthly' ? 'month' : 'year',
    prices,
  })
  console.log(`+ create ${name} → ${created.id}`)
  return { envKey, id: created.id }
}

async function main() {
  console.log(`Polar setup (server=${server})\n`)
  const existing = await listExistingProducts()
  const lines: string[] = []
  for (const planId of SUBSCRIBABLE_PLAN_IDS) {
    for (const period of periodsFor(planId)) {
      const { envKey, id } = await ensureProduct(planId, period, existing)
      lines.push(`${envKey}=${id}`)
    }
  }
  console.log(
    '\n# Paste into apps/dashboard/.env.production (or .env.production.local):'
  )
  console.log(lines.join('\n'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
