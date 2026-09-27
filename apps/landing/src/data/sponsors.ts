/**
 * Sponsors: who funds the free OSS build, and what each tier gets.
 *
 * Add a row after the payment lands and the sponsor confirms the listing: their
 * name, website link, and (optionally) a logo in `public/sponsors/`. The row is
 * the deliverable — the hero slot and /sponsors both render from it.
 */

import { LICENSE_HOOKS_ORIGIN, salesEmail } from './licenses'
import {
  DEFAULT_SPONSOR_TIER,
  isSponsorEmailAcceptable,
  SPONSOR_TIERS,
  type SponsorTier,
  type SponsorTierId,
  sponsorTier,
} from '@chm/pricing'

export {
  DEFAULT_SPONSOR_TIER,
  isSponsorEmailAcceptable,
  SPONSOR_TIERS,
  sponsorTier,
}
export type { SponsorTier, SponsorTierId }

export const SPONSOR_PAGE_HREF = 'https://chmonitor.dev/sponsors'
/** Sponsor questions, receipt chasing, logo swaps. Same inbox as licenses. */
export const SPONSOR_CONTACT_EMAIL = salesEmail

export interface Sponsor {
  /** Public name. Link label, and logo alt text. */
  name: string
  /** Public site, linked from the hero slot and the sponsors page. */
  website: string
  /** Optional logo in public/sponsors/ — SVG or PNG. The name is the fallback. */
  logo?: string
  tier: SponsorTierId
  /** YYYY-MM, the month the sponsorship started. */
  since: string
  /** Optional line they asked to show. Partner tier. */
  note?: string
}

export const sponsors: Sponsor[] = [
  {
    name: 'AnyRouter',
    website: 'https://anyrouter.dev',
    // Backer = the hero logo slot. No logo file committed yet, so the hero
    // renders the name as the wordmark; drop one in public/sponsors/ and set
    // `logo` to swap it in.
    tier: 'backer',
    since: '2026-09',
  },
]

/** Sponsors whose tier earns the logo slot under the hero. */
export function heroSponsors(rows: Sponsor[] = sponsors): Sponsor[] {
  return rows.filter((row) => sponsorTier(row.tier).hero)
}

/**
 * Sponsor details we collect in our UI and forward to Polar, which stores them
 * on the customer account (`customer_email` / `customer_name` /
 * `customer_metadata`) and on the order (`metadata`).
 */
export interface SponsorCheckoutInfo {
  tier?: SponsorTierId
  name?: string
  website?: string
  email?: string
  logo?: string
}

/**
 * Sponsor checkout on the hooks Worker. Amount is USD dollars; the Worker
 * resolves `tier` when no amount is given and converts to Polar cents.
 *
 * The Polar product is still `CHM_POLAR_DONATE_PRODUCT` — the name predates
 * the Sponsor rename and that id is committed in
 * apps/cloud-hooks/.env.production. Do not invent a product UUID here.
 */
export const SPONSOR_CHECKOUT_PATH = '/checkout/sponsor'

/**
 * `amount` only = the "Pick" path: straight to Polar, nothing collected.
 * With `info` = the details path, forwarded so Polar stores them on the
 * sponsor's account and we can build the listing from the order.
 */
export function sponsorHref(
  amountUsd: number,
  info?: SponsorCheckoutInfo
): string {
  const params = new URLSearchParams({ amount: String(amountUsd) })
  if (info?.tier) params.set('tier', info.tier)
  if (info?.name) params.set('name', info.name)
  if (info?.website) params.set('website', info.website)
  if (info?.email) params.set('email', info.email)
  if (info?.logo) params.set('logo', info.logo)
  return `${LICENSE_HOOKS_ORIGIN}${SPONSOR_CHECKOUT_PATH}?${params}`
}

/**
 * Form action for the details form. It GET-submits straight to the checkout
 * route, so the same fields reach Polar with or without JavaScript.
 */
export function sponsorCheckoutAction(): string {
  return `${LICENSE_HOOKS_ORIGIN}${SPONSOR_CHECKOUT_PATH}`
}

/** Fallback for a PO, a wire transfer, or a checkout that already happened. */
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
