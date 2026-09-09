import { publicLicensedCompanies } from './licensed-companies'
import {
  bossPitch,
  bossPitchPaste,
  buyHref,
  DONATE_AMOUNTS_USD,
  donateCheckoutAction,
  donateHref,
  invoiceMailto,
  LICENSE_PAGE_HREF,
  PRICING_PAGE_HREF,
  paidLicenseSkus,
} from './licenses'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getLicense,
  LICENSE_SKU_LIST,
  licensePriceUsd,
  PERSONAL_SELFHOST_HREF,
} from '@chm/pricing'

const landingRoot = join(import.meta.dir, '../..')

describe('landing license offer', () => {
  test('personal CTA is self-host docs, not register', () => {
    const personal = getLicense('personal')
    expect(buyHref(personal, 'yearly')).toBe(PERSONAL_SELFHOST_HREF)
    expect(buyHref(personal, 'lifetime')).toBe(PERSONAL_SELFHOST_HREF)
    expect(invoiceMailto(personal, 'yearly')).toBe(PERSONAL_SELFHOST_HREF)
  })

  test('help email is duyet@ for product questions', async () => {
    const { LICENSE_HELP_EMAIL, LICENSE_HELP_DOCS_HREF } = await import(
      './licenses'
    )
    expect(LICENSE_HELP_EMAIL).toBe('duyet@chmonitor.dev')
    expect(LICENSE_HELP_DOCS_HREF).toContain('commercial-license')
  })

  test('paid CTA goes to the company form before Polar', () => {
    const team = getLicense('team')
    expect(buyHref(team, 'yearly')).toBe(
      '/license/register?sku=team&term=yearly'
    )
    expect(buyHref(team, 'lifetime')).toBe(
      '/license/register?sku=team&term=lifetime'
    )
    expect(buyHref(getLicense('unlimited'), 'yearly')).toBe(
      '/license/register?sku=unlimited&term=yearly'
    )
    expect(paidLicenseSkus.map((s) => s.id)).toEqual(['team', 'unlimited'])
    expect(LICENSE_SKU_LIST).toHaveLength(3)
  })

  test('boss pitch is built from catalog prices and pastes as one email', () => {
    const team = getLicense('team')
    const unlimited = getLicense('unlimited')
    const yearly = licensePriceUsd(team, 'yearly')
    const lifetime = licensePriceUsd(team, 'lifetime')
    const unlimitedYearly = licensePriceUsd(unlimited, 'yearly')

    expect(bossPitch.subject).toContain(`$${yearly}`)
    expect(bossPitch.body).toContain(`$${yearly}/year`)
    expect(bossPitch.body).toContain(`$${lifetime}`)
    expect(bossPitch.body).toContain(`$${unlimitedYearly}/year`)
    expect(bossPitch.body).toContain(LICENSE_PAGE_HREF)
    expect(LICENSE_PAGE_HREF).toBe('https://chmonitor.dev/license')
    expect(PRICING_PAGE_HREF).toBe(LICENSE_PAGE_HREF)
    expect(bossPitch.body).toMatch(/no DRM/i)
    expect(bossPitch.body).toMatch(/invoice/i)
    expect(bossPitch.body).not.toMatch(/2am|begging|eleven browser tabs/i)

    expect(bossPitchPaste).toBe(
      `Subject: ${bossPitch.subject}\n\n${bossPitch.body}`
    )
  })

  test('license page renders the email composer from the same pitch', () => {
    const src = readFileSync(
      join(landingRoot, 'src/pages/license.astro'),
      'utf8'
    )
    expect(src).toContain('bossPitch.to')
    expect(src).toContain('bossPitch.subject')
    expect(src).toContain('bossPitch.body')
    expect(src).toContain('bossPitchPaste')
    expect(src).toContain('Copy this to your boss')
    expect(src).toContain('New message')
    expect(src).not.toContain('Copy for Slack')
    expect(src.indexOf('tell-your-boss')).toBeLessThan(
      src.indexOf('license-faq')
    )
  })

  test('invoice mailto is honor-system and asks for company + website', () => {
    const href = invoiceMailto(getLicense('team'), 'yearly')
    expect(href.startsWith('mailto:hello@chmonitor.dev?')).toBe(true)
    const decoded = decodeURIComponent(href)
    expect(decoded).toContain('Company name:')
    expect(decoded).toContain('Website:')
    expect(decoded).toContain('List us on the public customers page? yes / no')
    expect(decoded).toContain('$499')
  })
})

describe('customers listing is opt-in', () => {
  test('private rows are hidden', () => {
    const rows = [
      {
        name: 'Secret Co',
        website: 'https://secret.example',
        hosts: 3,
        term: 'yearly' as const,
        since: '2026-08',
        listPublic: false,
      },
      {
        name: 'Public Co',
        website: 'https://public.example',
        hosts: null,
        term: 'lifetime' as const,
        since: '2026-08',
        listPublic: true,
      },
    ]
    const pub = publicLicensedCompanies(rows)
    expect(pub).toHaveLength(1)
    expect(pub[0].name).toBe('Public Co')
  })

  test('committed seed has no private-leaking public list', () => {
    expect(publicLicensedCompanies().every((c) => c.listPublic)).toBe(true)
  })
})

describe('static pages exist', () => {
  test('license, register, lookup, and customers pages are in source', () => {
    expect(existsSync(join(landingRoot, 'src/pages/license.astro'))).toBe(true)
    expect(existsSync(join(landingRoot, 'src/pages/pricing.astro'))).toBe(true)
    expect(
      existsSync(join(landingRoot, 'src/pages/license/register.astro'))
    ).toBe(true)
    expect(
      existsSync(join(landingRoot, 'src/pages/license/lookup.astro'))
    ).toBe(true)
    expect(existsSync(join(landingRoot, 'src/pages/customers.astro'))).toBe(
      true
    )
  })

  test('register form requires company and website; list checkbox is off', () => {
    const src = readFileSync(
      join(landingRoot, 'src/pages/license/register.astro'),
      'utf8'
    )
    expect(src).toContain('name="company" required')
    expect(src).toContain('name="website" required')
    expect(src).toContain('name="list_public"')
    expect(src).not.toMatch(/name="list_public"[^>]*checked/)
    expect(src).toContain('licenseSkus')
    expect(src).toContain('No DRM')
    expect(src).toContain('licenseRegisterApiHref')
    expect(src).toContain('fetch(registerApi')
    expect(src).toContain('plan-grid')
    expect(src).toContain('Tax.')
    expect(src).toContain('duyet@chmonitor.dev')
    expect(src).toContain('LICENSE_HELP_DOCS_HREF')
    expect(src).toContain('Polar adds VAT/GST')
  })

  test('/pricing is a 301 to /license, not a duplicate page', () => {
    const src = readFileSync(
      join(landingRoot, 'src/pages/pricing.astro'),
      'utf8'
    )
    expect(src).toContain("Astro.redirect('/license', 301)")
    expect(src).not.toContain('bossPitch')
  })
})

describe('donate chips go to Polar via hooks, not GitHub Sponsors', () => {
  test('amounts are $10, $100, $1,000 Polar donate checkouts in USD dollars', () => {
    expect([...DONATE_AMOUNTS_USD]).toEqual([10, 100, 1000])
    expect(donateCheckoutAction()).toBe(
      'https://hooks.chmonitor.dev/checkout/donate'
    )
    for (const amount of DONATE_AMOUNTS_USD) {
      const href = donateHref(amount)
      expect(href).toBe(
        `https://hooks.chmonitor.dev/checkout/donate?amount=${amount}`
      )
      expect(href).not.toContain('github.com/sponsors')
    }
  })

  test('cloud-hooks Polar donate product id is a Polar UUID from polar-setup', () => {
    const env = readFileSync(
      join(landingRoot, '../cloud-hooks/.env.production'),
      'utf8'
    )
    const example = readFileSync(
      join(landingRoot, '../cloud-hooks/.env.example'),
      'utf8'
    )
    expect(env).toContain('CHM_POLAR_LICENSE_TEAM_YEARLY')
    expect(env).toMatch(/^CHM_POLAR_DONATE_PRODUCT=[a-f0-9-]{36}$/m)
    expect(example).toContain('CHM_POLAR_DONATE_PRODUCT')
  })

  test('license page lists chips plus a custom amount form below the plan cards', () => {
    const src = readFileSync(
      join(landingRoot, 'src/pages/license.astro'),
      'utf8'
    )
    expect(src.indexOf('<Pricing compact={true} />')).toBeLessThan(
      src.indexOf('id="donate"')
    )
    expect(src).toContain('DONATE_AMOUNTS_USD')
    expect(src).toContain('donateHref')
    expect(src).toContain('donateCheckoutAction')
    expect(src).toContain('name="amount"')
    expect(src).toContain('donate-custom')
    expect(src).toMatch(/logo and website/i)
    expect(src).toMatch(/main page/i)
    expect(src).not.toContain('github.com/sponsors')
  })
})
