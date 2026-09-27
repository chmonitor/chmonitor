import {
  heroSponsors,
  SPONSOR_CONTACT_EMAIL,
  SPONSOR_PAGE_HREF,
  SPONSOR_TIERS,
  type Sponsor,
  sponsorCheckoutAction,
  sponsorHref,
  sponsorMailto,
  sponsorRegisterApiHref,
  sponsors,
} from './sponsors'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const landingRoot = join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(join(landingRoot, rel), 'utf8')

describe('sponsorship tiers', () => {
  test('three one-off tiers at $59, $99, $199, ascending', () => {
    expect(SPONSOR_TIERS.map((tier) => tier.amountUsd)).toEqual([59, 99, 199])
    expect(SPONSOR_TIERS.map((tier) => tier.id)).toEqual([
      'supporter',
      'backer',
      'partner',
    ])
    for (const tier of SPONSOR_TIERS) {
      expect(tier.pitch.length).toBeGreaterThan(10)
    }
  })

  test('exactly one highlighted tier, and it is a hero tier', () => {
    const highlighted = SPONSOR_TIERS.filter((tier) => tier.highlight)
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].hero).toBe(true)
  })

  test('the hero slot is earned at $99 and up, not at $59', () => {
    const byId = Object.fromEntries(SPONSOR_TIERS.map((t) => [t.id, t]))
    expect(byId.supporter.hero).toBe(false)
    expect(byId.backer.hero).toBe(true)
    expect(byId.partner.hero).toBe(true)
  })
})

describe('sponsor checkout goes to Polar via hooks, not GitHub Sponsors', () => {
  test('each tier is a USD checkout on the hooks Worker', () => {
    expect(sponsorCheckoutAction()).toBe(
      'https://hooks.chmonitor.dev/checkout/donate'
    )
    for (const tier of SPONSOR_TIERS) {
      const href = sponsorHref(tier.amountUsd)
      expect(href).toBe(
        `https://hooks.chmonitor.dev/checkout/donate?amount=${tier.amountUsd}`
      )
      expect(href).not.toContain('github.com/sponsors')
    }
  })

  test('sponsor register posts to the hooks Worker listing endpoint', () => {
    expect(sponsorRegisterApiHref()).toBe(
      'https://hooks.chmonitor.dev/sponsors/register'
    )
  })

  test('the Polar product id is still the committed donate product', () => {
    const env = readFileSync(
      join(landingRoot, '../cloud-hooks/.env.production'),
      'utf8'
    )
    expect(env).toMatch(/^CHM_POLAR_DONATE_PRODUCT=[a-f0-9-]{36}$/m)
  })

  test('mailto fallback carries the tier price and the fields we publish', () => {
    const href = sponsorMailto('partner')
    expect(href.startsWith(`mailto:${SPONSOR_CONTACT_EMAIL}?`)).toBe(true)
    const decoded = decodeURIComponent(href)
    expect(decoded).toContain('$199')
    expect(decoded).toContain('Name:')
    expect(decoded).toContain('Website:')
    expect(decoded).toContain('Logo URL (optional):')
  })
})

describe('no sponsor yet renders the open-slot design, not a gap', () => {
  test('the seed is empty, so the hero slot shows the placeholder', () => {
    expect(sponsors).toEqual([])
    expect(heroSponsors()).toEqual([])
  })

  test('heroSponsors keeps hero tiers and drops the $59 supporter tier', () => {
    const rows: Sponsor[] = [
      {
        name: 'Supporter Co',
        website: 'https://supporter.example',
        tier: 'supporter',
        since: '2026-09',
      },
      {
        name: 'Backer Co',
        website: 'https://backer.example',
        logo: '/sponsors/backer.svg',
        tier: 'backer',
        since: '2026-09',
      },
    ]
    expect(heroSponsors(rows).map((s) => s.name)).toEqual(['Backer Co'])
  })

  test('the hero slot carries the placeholder, the price, and the sponsor link', () => {
    const src = read('src/components/SponsorSlot.astro')
    expect(src).toContain('data-sponsor-slot')
    expect(src).toContain('data-sponsor-placeholder')
    expect(src).toContain('Your logo')
    expect(src).toContain('Sponsor slot open')
    expect(src).toContain('heroFrom.amountUsd')
    expect(src).toContain('href="/license#sponsor"')
    expect(src).toContain('heroSponsors()')
    // The filled state must survive the empty one: rel=sponsored on the link.
    expect(src).toContain('rel="noopener sponsored"')
  })

  test('Hero renders the sponsor slot under the feature list', () => {
    const src = read('src/components/Hero.astro')
    expect(src).toContain("import SponsorSlot from './SponsorSlot.astro'")
    expect(src).toContain('<SponsorSlot />')
    expect(src.indexOf('data-hero-features')).toBeLessThan(
      src.indexOf('<SponsorSlot />')
    )
  })
})

describe('/sponsors listing page', () => {
  test('the page exists and the sitemap lists it', () => {
    expect(existsSync(join(landingRoot, 'src/pages/sponsors.astro'))).toBe(true)
    const siteUrls = read('src/lib/site-urls.ts')
    expect(siteUrls).toContain("path: '/sponsors'")
  })

  test('every tier is offered with its own Polar checkout link', () => {
    const src = read('src/pages/sponsors.astro')
    expect(src).toContain('SPONSOR_TIERS.map')
    expect(src).toContain('sponsorHref(tier.amountUsd)')
    expect(src).toContain('data-sponsor-open-slot')
  })

  test('the claim form asks for name, website, and email', () => {
    const src = read('src/pages/sponsors.astro')
    expect(src).toContain('name="name" required')
    expect(src).toContain('name="website" required')
    expect(src).toContain('name="email" required')
    expect(src).toContain('name="tier"')
    expect(src).toContain('sponsorRegisterApiHref')
    // A failed POST must fall back to email rather than dropping the listing.
    expect(src).toContain('mailtoFallback')
    // The email is collected but never published.
    expect(src).toMatch(/never rendered on the site/i)
  })

  test('the footer links the sponsors page', () => {
    expect(read('src/components/Footer.astro')).toContain("to('/sponsors')")
  })

  test('SPONSOR_PAGE_HREF is the canonical page', () => {
    expect(SPONSOR_PAGE_HREF).toBe('https://chmonitor.dev/sponsors')
  })
})

describe('the license page sells sponsorship, not donations', () => {
  const src = read('src/pages/license.astro')

  test('the section is #sponsor and says Sponsor', () => {
    expect(src).toContain('id="sponsor"')
    expect(src).not.toContain('id="donate"')
    expect(src).toContain('<h2>Sponsor</h2>')
    expect(src).toContain('>Sponsor</button>')
    expect(src).not.toMatch(/>Donate</)
  })

  test('chips are the three tiers, each with what it gets', () => {
    expect(src).toContain('SPONSOR_TIERS.map')
    expect(src).toContain('sponsorHref(tier.amountUsd)')
    expect(src).toContain('sponsor-tier-pitch')
    expect(src.indexOf('<Pricing compact={true} />')).toBeLessThan(
      src.indexOf('id="sponsor"')
    )
  })

  test('the copy promises the hero logo and points at the sponsors page', () => {
    expect(src).toMatch(/logo under the homepage hero/i)
    expect(src).toMatch(/sponsors page/i)
    expect(src).toContain('href="/sponsors#claim"')
    expect(src).toContain('name="amount"')
  })
})
