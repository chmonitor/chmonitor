/**
 * Sponsors: who funds the free OSS build, and what each tier gets.
 *
 * The seed is empty on purpose. The hero slot and /sponsors both render an
 * open-slot design in that state — a dashed logo placeholder plus the price and
 * a link to the sponsor page — so "no sponsor yet" is a designed state, not a
 * gap someone has to notice.
 *
 * Add a row after the payment lands and the sponsor confirms the listing: their
 * name, website link, and logo are the deliverable.
 */

import { LICENSE_HOOKS_ORIGIN, salesEmail } from './licenses'
import {
  DEFAULT_SPONSOR_TIER,
  SPONSOR_TIERS,
  type SponsorTier,
  type SponsorTierId,
  sponsorTier,
} from '@chm/pricing'

export { DEFAULT_SPONSOR_TIER, SPONSOR_TIERS, sponsorTier }
export type { SponsorTier, SponsorTierId }

export const SPONSOR_PAGE_HREF = 'https://chmonitor.dev/sponsors'
/** Sponsor questions, receipt chasing, logo swaps. Same inbox as licenses. */
export const SPONSOR_CONTACT_EMAIL = salesEmail

export interface Sponsor {
  /** Public name. Link label, and logo alt text. */
  name: string
  /** Public site, linked from the hero slot and the sponsors page. */
  website: string
  /** Optional logo in public/ — SVG or PNG. The name is the fallback. */
  logo?: string
  tier: SponsorTierId
  /** YYYY-MM, the month the sponsorship started. */
  since: string
  /** Optional line they asked to show. Partner tier. */
  note?: string
}

export const sponsors: Sponsor[] = [
  // Empty until the first confirmed sponsor. The hero slot and /sponsors render
  // their open-slot designs off this.
]

/** Sponsors whose tier earns the logo slot under the hero. */
export function heroSponsors(rows: Sponsor[] = sponsors): Sponsor[] {
  return rows.filter((row) => sponsorTier(row.tier).hero)
}

/**
 * Sponsor checkout. The amount is USD dollars; the hooks Worker converts to
 * Polar cents.
 *
 * The wire path is still `/checkout/donate` and the Polar product is still
 * `CHM_POLAR_DONATE_PRODUCT`: that var carries a live product id committed in
 * apps/cloud-hooks/.env.production, and renaming it needs a `polar-setup.ts`
 * run with POLAR_ACCESS_TOKEN. The user-facing name is Sponsor. Do not invent a
 * product UUID here.
 */
export const SPONSOR_CHECKOUT_PATH = '/checkout/donate'
export const SPONSOR_REGISTER_PATH = '/sponsors/register'

export function sponsorHref(amountUsd: number): string {
  const params = new URLSearchParams({ amount: String(amountUsd) })
  return `${LICENSE_HOOKS_ORIGIN}${SPONSOR_CHECKOUT_PATH}?${params}`
}

/** Form action for the custom-amount input. */
export function sponsorCheckoutAction(): string {
  return `${LICENSE_HOOKS_ORIGIN}${SPONSOR_CHECKOUT_PATH}`
}

export function sponsorRegisterApiHref(): string {
  return `${LICENSE_HOOKS_ORIGIN}${SPONSOR_REGISTER_PATH}`
}

/** Fallback when the hooks Worker is down, and for PO-style asks. */
export function sponsorMailto(
  tierId: SponsorTierId = DEFAULT_SPONSOR_TIER
): string {
  const tier = sponsorTier(tierId)
  const subject = encodeURIComponent(
    `chmonitor sponsorship — ${tier.label} ($${tier.amountUsd})`
  )
  const body = encodeURIComponent(
    [
      'I would like to sponsor chmonitor.',
      '',
      `Tier: ${tier.label} ($${tier.amountUsd} one-off)`,
      '',
      'Name:',
      'Website:',
      'Logo URL (optional):',
      'Email:',
      '',
      'Paid already? Reply with the Polar checkout id.',
    ].join('\n')
  )
  return `mailto:${SPONSOR_CONTACT_EMAIL}?subject=${subject}&body=${body}`
}
