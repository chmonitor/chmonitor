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
/** Support only — a question about a listing, a logo swap, a receipt. */
export const SPONSOR_CONTACT_EMAIL = salesEmail

export interface Sponsor {
  /** Public name. Wordmark, and the logo's alt text. */
  name: string
  /** Public site, linked from the hero slot and the sponsors page. */
  website: string
  /**
   * Mark in `public/sponsors/` — the light-theme variant. Pair it with
   * `logoDark`: a single-colour mark is invisible on the other theme, and the
   * Base layout's `data-src-light`/`data-src-dark` swap needs both files.
   */
  logo?: string
  /** Dark-theme variant of `logo`. Omit only for a full-colour mark. */
  logoDark?: string
  /** One muted line under the wordmark, in their words. */
  tagline?: string
  /**
   * Fallback `?ref` when the sponsor's own URL does not already carry one.
   * The URL always wins — see `sponsorLink`.
   */
  ref?: string
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
    // Their published brand mark, both themes: a single-colour AR monogram is
    // invisible on the wrong background, so commit the pair and let the Base
    // layout swap it on the theme toggle.
    logo: '/sponsors/anyrouter.svg',
    logoDark: '/sponsors/anyrouter-dark.svg',
    ref: 'anyrouter',
    tier: 'hero',
    since: '2026-09',
  },
]

/** Sponsors whose tier earns the logo slot under the hero. */
export function heroSponsors(rows: Sponsor[] = sponsors): Sponsor[] {
  return rows.filter((row) => sponsorTier(row.tier).hero)
}

function refSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The tracked URL for a sponsor link — one helper so the hero and the wall
 * cannot send different analytics.
 *
 * `ref` is the sponsor's own campaign key; the utm_* set is ours (`source` the
 * site, `medium` marks it as a sponsorship rather than an editorial link,
 * `campaign` which surface, `content` the tier).
 *
 * **Never overwrite.** A param already on the sponsor's URL belongs to the
 * sponsor's own tracking — their `ref` is their campaign key and their
 * `utm_source` is their referral — so each one is added only when absent.
 */
export function sponsorLink(sponsor: Sponsor, campaign: string): string {
  try {
    const url = new URL(sponsor.website)
    const setIfAbsent = (key: string, value: string) => {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value)
    }
    setIfAbsent('ref', sponsor.ref ?? refSlug(sponsor.name))
    setIfAbsent('utm_source', 'chmonitor')
    setIfAbsent('utm_medium', 'sponsor')
    setIfAbsent('utm_campaign', campaign)
    setIfAbsent('utm_content', sponsor.tier)
    return url.toString()
  } catch {
    // A malformed website in the seed must not take the page down at build.
    return sponsor.website
  }
}

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
 * The Polar product is `chmonitor Sponsor`
 * (`CHM_POLAR_SPONSOR_PRODUCT`), renamed in place from `chmonitor Donate`, so
 * the id in apps/cloud-hooks/.env.production never changed. Do not invent a
 * product UUID here.
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
