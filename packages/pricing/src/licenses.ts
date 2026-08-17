/**
 * Self-hosted licenses — Personal (free), Team, Unlimited.
 *
 * Cloud SaaS plans stay in `plans.ts`. Paid SKUs are a commercial agreement
 * + support. The binary stays GPL-3.0; no DRM, honor-system registration.
 *
 * Lifetime ≈ 3× yearly.
 */

export const LICENSE_IDS = ['personal', 'team', 'unlimited'] as const
export type LicenseId = (typeof LICENSE_IDS)[number]
export type LicenseTerm = 'yearly' | 'lifetime'

export interface LicenseSku {
  id: LicenseId
  name: string
  /** Marketing card title (may be longer than `name`). */
  displayName: string
  tagline: string
  /** Monitored connections included. null = unlimited. */
  hosts: number | null
  yearlyUsd: number
  lifetimeUsd: number
  highlight?: boolean
  highlights: string[]
}

export const LICENSE_SKUS: Record<LicenseId, LicenseSku> = {
  personal: {
    id: 'personal',
    name: 'Personal',
    displayName: 'Personal Self Hosted',
    tagline: 'Self-host for yourself. GPL-3.0, no key.',
    hosts: null,
    yearlyUsd: 0,
    lifetimeUsd: 0,
    highlights: [
      'Self-host on your infra',
      'Every feature, unlimited hosts',
      'GPL-3.0 — no license key',
      'Community support',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    displayName: 'Team',
    tagline: 'A few clusters on your own infra.',
    hosts: 3,
    yearlyUsd: 499,
    lifetimeUsd: 1349,
    highlight: true,
    highlights: [
      '3 monitored hosts',
      'Commercial license (invoice-ready)',
      'Priority email support',
      'Optional listing on the customers page',
    ],
  },
  unlimited: {
    id: 'unlimited',
    name: 'Unlimited',
    displayName: 'Unlimited',
    tagline: 'No host cap. One license for the company.',
    hosts: null,
    yearlyUsd: 999,
    lifetimeUsd: 2999,
    highlights: [
      'Unlimited monitored hosts',
      'Commercial license (invoice-ready)',
      'Priority email support',
      'Optional listing on the customers page',
    ],
  },
}

export const LICENSE_SKU_LIST: LicenseSku[] = LICENSE_IDS.map(
  (id) => LICENSE_SKUS[id]
)

export const PAID_LICENSE_IDS = ['team', 'unlimited'] as const

export function isPaidLicense(id: LicenseId): boolean {
  return LICENSE_SKUS[id].yearlyUsd > 0
}

export function getLicense(id: LicenseId): LicenseSku {
  return LICENSE_SKUS[id]
}

export function licensePriceUsd(sku: LicenseSku, term: LicenseTerm): number {
  return term === 'lifetime' ? sku.lifetimeUsd : sku.yearlyUsd
}

export function licenseHostsLabel(sku: LicenseSku): string {
  return sku.hosts === null
    ? 'Unlimited hosts'
    : `${sku.hosts} host${sku.hosts === 1 ? '' : 's'}`
}

/** Lifetime ÷ yearly. Paid SKUs are ~3×. */
export function lifetimeMultiple(sku: LicenseSku): number | null {
  if (!sku.yearlyUsd) return null
  return Math.round((sku.lifetimeUsd / sku.yearlyUsd) * 10) / 10
}

export const LICENSE_SALES_EMAIL = 'hello@chmonitor.dev'
export const LICENSE_PURCHASE_PATH = '/license/register'
export const PERSONAL_SELFHOST_HREF =
  'https://docs.chmonitor.dev/operate/deploy/self-host'

export type PaidLicenseId = (typeof PAID_LICENSE_IDS)[number]

/** Env key for the Polar product id (dashboard / polar-setup). */
export function licensePolarProductEnvKey(
  id: PaidLicenseId,
  term: LicenseTerm
): string {
  return `CHM_POLAR_LICENSE_${id.toUpperCase()}_${term.toUpperCase()}`
}

/** Polar product name — polar-setup matches existing products by this. */
export function licensePolarProductName(
  id: PaidLicenseId,
  term: LicenseTerm
): string {
  const sku = LICENSE_SKUS[id]
  const label = term === 'lifetime' ? 'Lifetime' : 'Yearly'
  return `chmonitor ${sku.name} License (${label})`
}

export function licensePolarPriceCents(
  id: PaidLicenseId,
  term: LicenseTerm
): number {
  return Math.round(licensePriceUsd(LICENSE_SKUS[id], term) * 100)
}
