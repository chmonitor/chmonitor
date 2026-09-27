import {
  heroSponsors,
  isSponsorEmailAcceptable,
  SPONSOR_CONTACT_EMAIL,
  SPONSOR_PAGE_HREF,
  SPONSOR_TIERS,
  type Sponsor,
  sponsorCheckoutAction,
  sponsorHref,
  sponsorMailto,
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

describe('sponsor checkout forwards the details to Polar', () => {
  test('pick-only is one hop to the hooks Worker with just the amount', () => {
    expect(sponsorCheckoutAction()).toBe(
      'https://hooks.chmonitor.dev/checkout/sponsor'
    )
    for (const tier of SPONSOR_TIERS) {
      const href = sponsorHref(tier.amountUsd)
      expect(href).toBe(
        `https://hooks.chmonitor.dev/checkout/sponsor?amount=${tier.amountUsd}`
      )
      expect(href).not.toContain('github.com/sponsors')
    }
  })

  test('the details path carries name, website, email, and logo', () => {
    const href = sponsorHref(99, {
      tier: 'backer',
      name: 'Acme Analytics',
      website: 'https://acme.example',
      email: 'ops@acme.example',
      logo: 'https://acme.example/logo.svg',
    })
    const url = new URL(href)
    expect(url.pathname).toBe('/checkout/sponsor')
    expect(url.searchParams.get('amount')).toBe('99')
    expect(url.searchParams.get('tier')).toBe('backer')
    expect(url.searchParams.get('name')).toBe('Acme Analytics')
    expect(url.searchParams.get('website')).toBe('https://acme.example')
    expect(url.searchParams.get('email')).toBe('ops@acme.example')
    expect(url.searchParams.get('logo')).toBe('https://acme.example/logo.svg')
  })

  test('the Polar product id is still the committed donate product', () => {
    const env = readFileSync(
      join(landingRoot, '../cloud-hooks/.env.production'),
      'utf8'
    )
    expect(env).toMatch(/^CHM_POLAR_DONATE_PRODUCT=[a-f0-9-]{36}$/m)
    // The route and the module are renamed; the product id key is not, because
    // it is committed. Assert the rename did not touch the committed key.
    expect(read('../cloud-hooks/src/sponsor-checkout.ts')).toContain(
      "SPONSOR_PRODUCT_ENV_KEY = 'CHM_POLAR_DONATE_PRODUCT'"
    )
  })

  test('the form refuses a placeholder email before Polar sees it', () => {
    // Polar 422s these; the form must not be the thing that finds out.
    expect(isSponsorEmailAcceptable('you@example.com')).toBe(false)
    expect(isSponsorEmailAcceptable('ops@acme.com')).toBe(true)
    const src = read('src/components/SponsorOffer.astro')
    expect(src).toContain('isSponsorEmailAcceptable')
    expect(src).toContain('data-email-error')
    expect(src).toMatch(/cannot send a receipt/i)
  })

  test('the details form GET-submits to the checkout route itself', () => {
    const src = read('src/components/SponsorOffer.astro')
    expect(src).toContain('action={action}')
    expect(src).toContain('sponsorCheckoutAction()')
    expect(src).toContain('method="get"')
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

describe('the offer has a pick button and a submit button', () => {
  const src = read('src/components/SponsorOffer.astro')

  test('every tier offers Pick (direct) and Add my details (the form)', () => {
    expect(src).toContain('sponsorHref(tier.amountUsd)')
    expect(src).toContain('data-add-details={tier.id}')
    expect(src).toMatch(/data-cta=\{`sponsor-pick-\$\{tier\.id\}`\}/)
    expect(src).toMatch(/data-cta=\{`sponsor-details-\$\{tier\.id\}`\}/)
  })

  test('the form collects name, website, email, and logo, then submits', () => {
    expect(src).toContain('name="name"')
    expect(src).toContain('name="website"')
    expect(src).toContain('name="email"')
    expect(src).toContain('name="logo"')
    expect(src).toContain('name="tier"')
    expect(src).toContain('name="amount"')
    expect(src).toContain('data-cta="sponsor-submit"')
  })

  test('the amount shown on submit is derived, never hard-coded per tier', () => {
    expect(src).toMatch(/data-label="Sponsor \{amount\} and continue to Polar"/)
    expect(src).toContain('amountLabel(defaultTier.amountUsd)')
    expect(src).toContain('input[name=tier]:checked')
  })

  test('both surfaces share the one offer component', () => {
    expect(read('src/pages/license.astro')).toContain('<SponsorOffer />')
    expect(read('src/pages/sponsors.astro')).toContain('<SponsorOffer />')
  })
})

describe('the hero slot lists sponsors and keeps the open slot small', () => {
  const src = read('src/components/SponsorSlot.astro')

  test('AnyRouter is the first sponsor, linked to anyrouter.dev', () => {
    expect(sponsors).toHaveLength(1)
    const [first] = sponsors
    expect(first.name).toBe('AnyRouter')
    expect(first.website).toBe('https://anyrouter.dev')
    expect(first.tier).toBe('backer')
    expect(first.since).toMatch(/^\d{4}-\d{2}$/)
    // A hero sponsor must actually earn the hero slot.
    expect(heroSponsors().map((s) => s.name)).toEqual(['AnyRouter'])
  })

  test('the open slot stays a compact tile, not a card with a paragraph', () => {
    expect(src).toContain('data-sponsor-slot')
    expect(src).toContain('data-sponsor-placeholder')
    expect(src).toContain('+ your logo')
    expect(src).toContain('href="/license#sponsor"')
    // The old long-form copy is gone; the tile carries the price in a <span>.
    expect(src).not.toMatch(/Sponsor slot open<\/p>/)
    expect(src).not.toContain('one-off puts your logo and link right here')
    expect(src).toContain('heroFrom.amountUsd')
    // Same footprint as a sponsor logo, so the row stays a row.
    expect(src).toContain('h-11 w-28')
  })

  test('sponsor links are rel=sponsored so SEO follows the link', () => {
    expect(src).toContain('rel="noopener sponsored"')
  })

  test('Hero renders the sponsor slot under the feature list', () => {
    const hero = read('src/components/Hero.astro')
    expect(hero).toContain("import SponsorSlot from './SponsorSlot.astro'")
    expect(hero.indexOf('data-hero-features')).toBeLessThan(
      hero.indexOf('<SponsorSlot />')
    )
  })

  test('heroSponsors still drops a $59 supporter from the hero', () => {
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
        tier: 'backer',
        since: '2026-09',
      },
    ]
    expect(heroSponsors(rows).map((s) => s.name)).toEqual(['Backer Co'])
  })
})

describe('/sponsors listing page', () => {
  test('the page exists and the sitemap lists it', () => {
    expect(existsSync(join(landingRoot, 'src/pages/sponsors.astro'))).toBe(true)
    expect(read('src/lib/site-urls.ts')).toContain("path: '/sponsors'")
  })

  test('the wall lists sponsors and keeps an open tile', () => {
    const src = read('src/pages/sponsors.astro')
    expect(src).toContain('sponsors.map')
    expect(src).toContain('data-sponsor-open-slot')
    expect(src).toContain('+ your logo')
  })

  test('Polar sends the sponsor back to a paid confirmation', () => {
    const src = read('src/pages/sponsors.astro')
    expect(src).toContain("get('sponsored') !== '1'")
    expect(src).toMatch(/Payment received/)
    // The success URL the Worker builds must land here.
    expect(read('../cloud-hooks/src/sponsor-checkout.ts')).toContain(
      '/sponsors?sponsored=1&checkout_id={CHECKOUT_ID}'
    )
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
    expect(src).not.toMatch(/>Donate</)
  })

  test('the section hosts the shared offer and the PO escape hatch', () => {
    expect(src.indexOf('<Pricing compact={true} />')).toBeLessThan(
      src.indexOf('id="sponsor"')
    )
    expect(src).toContain('<SponsorOffer />')
    expect(src).toContain('sponsorMailto()')
    expect(src).toMatch(/logo under the homepage hero|PO or a wire/i)
  })
})
