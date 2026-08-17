import { publicLicensedCompanies } from './licensed-companies'
import { buyHref, invoiceMailto, paidLicenseSkus } from './licenses'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getLicense,
  LICENSE_SKU_LIST,
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

  test('paid CTA goes to Polar license checkout', () => {
    const team = getLicense('team')
    expect(buyHref(team, 'yearly')).toBe(
      'https://hooks.chmonitor.dev/checkout/license?sku=team&term=yearly'
    )
    expect(buyHref(team, 'lifetime')).toBe(
      'https://hooks.chmonitor.dev/checkout/license?sku=team&term=lifetime'
    )
    expect(buyHref(getLicense('unlimited'), 'yearly')).toBe(
      'https://hooks.chmonitor.dev/checkout/license?sku=unlimited&term=yearly'
    )
    expect(paidLicenseSkus.map((s) => s.id)).toEqual(['team', 'unlimited'])
    expect(LICENSE_SKU_LIST).toHaveLength(3)
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
  test('pricing, register, and customers pages are in source', () => {
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
    expect(src).toContain('paidLicenseSkus')
    expect(src).toContain('Honor system')
    expect(src).toContain('licenseRegisterApiHref')
    expect(src).toContain('fetch(registerApi')
  })
})
