import {
  heroSponsors,
  isSponsorEmailAcceptable,
  SPONSOR_PAGE_HREF,
  SPONSOR_TIERS,
  type Sponsor,
  sponsorCheckoutAction,
  sponsorHref,
  sponsorLink,
  sponsors,
} from './sponsors'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const landingRoot = join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(join(landingRoot, rel), 'utf8')

describe('sponsorship tiers', () => {
  test('four one-off tiers at $19, $59, $99, $199, ascending', () => {
    expect(SPONSOR_TIERS.map((tier) => tier.amountUsd)).toEqual([
      19, 59, 99, 199,
    ])
    expect(SPONSOR_TIERS.map((tier) => tier.id)).toEqual([
      'supporter',
      'backer',
      'hero',
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

  test('the hero slot is earned at $99 and up, not below', () => {
    const byId = Object.fromEntries(SPONSOR_TIERS.map((t) => [t.id, t]))
    expect(byId.supporter.hero).toBe(false)
    expect(byId.backer.hero).toBe(false)
    expect(byId.hero.hero).toBe(true)
    expect(byId.partner.hero).toBe(true)
  })

  test('the ladder escalates: each rung adds something', () => {
    // $19 is the name alone; $59 adds the link; $99 adds the hero mark. A card
    // should never have to say what it does NOT get.
    expect(SPONSOR_TIERS[0].pitch).toBe('Your name on the sponsors page.')
    expect(SPONSOR_TIERS[1].pitch).toMatch(/link/i)
    expect(SPONSOR_TIERS[2].pitch).toMatch(/hero/i)
    expect(SPONSOR_TIERS[3].pitch).toMatch(/larger|short line/i)
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

  test('the card grid absorbs a new rung without a CSS change', () => {
    expect(src).toMatch(/grid-template-columns:repeat\(auto-fit,minmax/)
  })

  test('the amount shown on submit is derived, never hard-coded per tier', () => {
    expect(src).toMatch(
      /data-label="Sponsor \{amount\} and continue to payment"/
    )
    expect(src).toContain('amountLabel(defaultTier.amountUsd)')
    expect(src).toContain('input[name=tier]:checked')
  })

  test('the form is two labelled groups: the plan, then the information', () => {
    expect(src).toContain('Pick the plan')
    expect(src).toContain('Information')
    expect(src).toContain('(Optional)')
    expect(src).toContain('aria-labelledby="sponsor-plan-label"')
    expect(src).toContain('aria-labelledby="sponsor-info-label"')
  })

  test('the card is full width and the form is left-aligned', () => {
    expect(src).toMatch(/grid-template-columns:repeat\(auto-fit,minmax/)
    expect(src).toContain('text-align:left')
    // The license card is a centered column flex: without an explicit width the
    // auto-fit grid would collapse to its content width instead of filling it.
    expect(src).toMatch(/\.tiers\{[^}]*width:100%/)
    expect(src).toMatch(/\.details\{[^}]*width:100%/)
    expect(src).toMatch(/\.details\{[^}]*border-top/)
    // One level of card: the form is a hairline, not another box.
    expect(src).not.toMatch(/\.details\{[^}]*border:1px/)
  })

  test('no visible string in the offer names the payment provider', () => {
    // Strip the frontmatter, comments, and the inline script: the provider is
    // an implementation detail, and the copy speaks in our own voice.
    const markup = src
      .replace(/---[\s\S]*?\n---/, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
    expect(markup).not.toMatch(/Polar/i)
  })

  test('both surfaces share the one offer component', () => {
    expect(read('src/pages/license.astro')).toContain('<SponsorOffer />')
    expect(read('src/pages/sponsors.astro')).toContain('<SponsorOffer />')
  })
})

describe('sponsor links carry ref and utm params', () => {
  const [anyrouter] = sponsors

  test('adds ref plus the four utm params', () => {
    const url = new URL(sponsorLink(anyrouter, 'homepage-hero'))
    expect(url.origin + url.pathname).toBe('https://anyrouter.dev/')
    expect(url.searchParams.get('ref')).toBe('anyrouter')
    expect(url.searchParams.get('utm_source')).toBe('chmonitor')
    expect(url.searchParams.get('utm_medium')).toBe('sponsor')
    expect(url.searchParams.get('utm_campaign')).toBe('homepage-hero')
    // The tier travels with the click, so a sponsor sees what their money bought.
    expect(url.searchParams.get('utm_content')).toBe('hero')
  })

  test('ref falls back to a slug of the name', () => {
    const url = new URL(
      sponsorLink(
        {
          name: 'Acme Data Labs',
          website: 'https://acme.example',
          tier: 'supporter',
          since: '2026-09',
        },
        'sponsors-wall'
      )
    )
    expect(url.searchParams.get('ref')).toBe('acme-data-labs')
  })

  test('the campaign names the surface, so the hero and the wall are separable', () => {
    const hero = new URL(sponsorLink(anyrouter, 'homepage-hero'))
    const wall = new URL(sponsorLink(anyrouter, 'sponsors-wall'))
    expect(hero.searchParams.get('utm_campaign')).toBe('homepage-hero')
    expect(wall.searchParams.get('utm_campaign')).toBe('sponsors-wall')
    // Everything else is identical, or the numbers will not add up.
    for (const key of ['ref', 'utm_source', 'utm_medium', 'utm_content']) {
      expect(hero.searchParams.get(key)).toBe(wall.searchParams.get(key))
    }
  })

  test("never overwrites the sponsor's own tracking", () => {
    // Their ref is their campaign key and their utm_source is their referral.
    const url = new URL(
      sponsorLink(
        {
          name: 'Acme',
          website:
            'https://acme.example/?ref=their-spring-promo&utm_source=newsletter',
          ref: 'ignored',
          tier: 'backer',
          since: '2026-09',
        },
        'homepage-hero'
      )
    )
    expect(url.searchParams.get('ref')).toBe('their-spring-promo')
    expect(url.searchParams.get('utm_source')).toBe('newsletter')
    // Ours still fills the gaps.
    expect(url.searchParams.get('utm_medium')).toBe('sponsor')
    expect(url.searchParams.get('utm_campaign')).toBe('homepage-hero')
    expect(url.searchParams.get('utm_content')).toBe('backer')
  })

  test('preserves the sponsor path and hash, and survives a bad url', () => {
    const withPath = new URL(
      sponsorLink(
        {
          name: 'Acme',
          website: 'https://acme.example/pricing?utm_medium=cpc',
          tier: 'supporter',
          since: '2026-09',
        },
        'homepage-hero'
      )
    )
    expect(withPath.pathname).toBe('/pricing')
    expect(withPath.searchParams.get('utm_medium')).toBe('cpc')

    // A malformed seed must not take the page down at build time.
    const bad: Sponsor = {
      name: 'Broken',
      website: 'not a url',
      tier: 'supporter',
      since: '2026-09',
    }
    expect(sponsorLink(bad, 'homepage-hero')).toBe('not a url')
  })

  test('both surfaces use the helper, not the raw website', () => {
    expect(read('src/components/SponsorSlot.astro')).toContain(
      "sponsorLink(s, 'homepage-hero')"
    )
    expect(read('src/pages/sponsors.astro')).toContain(
      "sponsorLink(s, 'sponsors-wall')"
    )
  })
})

describe('the hero slot is a logo row, not a row of boxes', () => {
  const src = read('src/components/SponsorSlot.astro')

  test('AnyRouter is the first sponsor, with its real mark in both themes', () => {
    expect(sponsors).toHaveLength(1)
    const [first] = sponsors
    expect(first.name).toBe('AnyRouter')
    expect(first.website).toBe('https://anyrouter.dev')
    expect(first.tier).toBe('hero')
    expect(first.since).toMatch(/^\d{4}-\d{2}$/)
    // A single-colour mark is invisible on the wrong theme, so both files are
    // committed and the layout swaps them.
    expect(first.logo).toBe('/sponsors/anyrouter.svg')
    expect(first.logoDark).toBe('/sponsors/anyrouter-dark.svg')
    for (const rel of [first.logo, first.logoDark]) {
      const file = join(landingRoot, 'public', rel)
      expect(existsSync(file), rel).toBe(true)
      expect(readFileSync(file, 'utf8')).toMatch(/^<svg/)
    }
    expect(heroSponsors().map((s) => s.name)).toEqual(['AnyRouter'])
  })

  test('the marks sit on the page background — no bordered tiles', () => {
    expect(src).toContain('Featured sponsors')
    expect(src).toContain('list-none')
    expect(src).not.toContain('border-dashed')
    expect(src).not.toMatch(/h-11 w-28/)
  })

  test('the open slot is a line of text, and it hides the price', () => {
    expect(src).toContain('Want to support the free build?')
    expect(src).toContain('Start sponsoring')
    expect(src).toContain('data-sponsor-placeholder')
    expect(src).toContain('href="/license#sponsor"')
    // The price belongs on the offer, not on the logo row.
    expect(src).not.toMatch(/\{\s*heroFrom\.amountUsd\s*\}\s*<\/span>/)
    // It stays in the title, for the hover.
    expect(src).toContain('heroFrom.amountUsd')
  })

  test('sponsor links are rel=sponsored and theme-aware', () => {
    expect(src).toContain('rel="noopener sponsored"')
    expect(src).toContain('data-src-light={s.logo}')
    expect(src).toContain('data-src-dark={s.logoDark ?? s.logo}')
  })

  test('Hero renders the sponsor slot under the feature list', () => {
    const hero = read('src/components/Hero.astro')
    expect(hero).toContain("import SponsorSlot from './SponsorSlot.astro'")
    expect(hero.indexOf('data-hero-features')).toBeLessThan(
      hero.indexOf('<SponsorSlot />')
    )
  })

  test('heroSponsors still drops a supporter from the hero', () => {
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
      {
        name: 'Hero Co',
        website: 'https://hero.example',
        tier: 'hero',
        since: '2026-09',
      },
    ]
    expect(heroSponsors(rows).map((s) => s.name)).toEqual(['Hero Co'])
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
    expect(src).toContain('Your logo')
    // Same treatment as the hero: no boxes, ring on hover.
    expect(src).not.toContain('tile-open{border-style:dashed}')
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

  test('the section is the shared offer, full width, with no invoice CTA', () => {
    expect(src.indexOf('<Pricing compact={true} />')).toBeLessThan(
      src.indexOf('id="sponsor"')
    )
    expect(src).toContain('<SponsorOffer />')
    // The email is a support contact only: no PO or wire line on the card.
    expect(src).not.toMatch(/\bPO\b|\bwire\b|\binvoice\b/i)
    expect(src).not.toContain('SPONSOR_CONTACT_EMAIL')
    // Full width, and no box wrapped around the offer.
    expect(src).not.toMatch(/\.sponsor-card\{[^}]*max-width/)
    expect(src).not.toMatch(/\.sponsor-card\{[^}]*border:/)
  })
})
