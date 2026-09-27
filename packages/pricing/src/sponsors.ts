/**
 * Sponsorship tiers — one-off amounts, not a subscription.
 *
 * A sponsorship is not a license: it buys no features, no support window, and
 * no key. It funds the free GPL-3.0 build, and it earns a listing — the name
 * and website on the sponsors page, and the logo under the homepage hero from
 * $99 up.
 *
 * Shared by the landing page (which renders the tiers) and cloud-hooks (which
 * validates `tier` on POST /sponsors/register), so the API can never accept a
 * tier the page does not offer.
 */

export const SPONSOR_TIER_IDS = ['supporter', 'backer', 'partner'] as const
export type SponsorTierId = (typeof SPONSOR_TIER_IDS)[number]

export interface SponsorTier {
  id: SponsorTierId
  /** One-off USD amount. */
  amountUsd: number
  label: string
  /** Earns the logo slot under the homepage hero. */
  hero: boolean
  /** The recommended tier — rendered as the primary CTA. */
  highlight: boolean
  /** What the sponsor gets, in one sentence. */
  pitch: string
}

export const SPONSOR_TIERS: readonly SponsorTier[] = [
  {
    id: 'supporter',
    amountUsd: 59,
    label: 'Supporter',
    hero: false,
    highlight: false,
    pitch: 'Your name and a link to your site on the sponsors page.',
  },
  {
    id: 'backer',
    amountUsd: 99,
    label: 'Backer',
    hero: true,
    highlight: true,
    pitch:
      'Your logo and link under the homepage hero, plus the sponsors page.',
  },
  {
    id: 'partner',
    amountUsd: 199,
    label: 'Partner',
    hero: true,
    highlight: false,
    pitch:
      'A larger hero slot, plus a short line about you on the sponsors page.',
  },
]

/** The tier the page preselects: the recommended one, not the cheapest. */
export const DEFAULT_SPONSOR_TIER: SponsorTierId = 'backer'

export function isSponsorTier(value: string): value is SponsorTierId {
  return SPONSOR_TIER_IDS.some((id) => id === value)
}

export function sponsorTier(id: SponsorTierId): SponsorTier {
  // Callers pass a SponsorTierId, so a miss can only be a bad cast from
  // unvalidated input. Floor it on the first tier instead of undefined.
  return SPONSOR_TIERS.find((tier) => tier.id === id) ?? SPONSOR_TIERS[0]
}
