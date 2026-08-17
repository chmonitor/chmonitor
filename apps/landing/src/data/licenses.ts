/**
 * Landing view of self-hosted licenses. Numbers come from @chm/pricing.
 */
import {
  isPaidLicense,
  LICENSE_SALES_EMAIL,
  LICENSE_SKU_LIST,
  type LicenseSku,
  type LicenseTerm,
  licensePriceUsd,
  PERSONAL_SELFHOST_HREF,
} from '@chm/pricing'

export type { LicenseSku, LicenseTerm }

export const licenseSkus = LICENSE_SKU_LIST
export const paidLicenseSkus = LICENSE_SKU_LIST.filter((s) =>
  isPaidLicense(s.id)
)
export const salesEmail = LICENSE_SALES_EMAIL

export const LICENSE_HOOKS_ORIGIN =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: { PUBLIC_LICENSE_CHECKOUT_ORIGIN?: string } }).env
      ?.PUBLIC_LICENSE_CHECKOUT_ORIGIN) ||
  'https://hooks.chmonitor.dev'

/** Pricing Buy → company form first, then Polar. */
export function buyHref(sku: LicenseSku, term: LicenseTerm): string {
  if (!isPaidLicense(sku.id)) return PERSONAL_SELFHOST_HREF
  const params = new URLSearchParams({ sku: sku.id, term })
  return `/license/register?${params}`
}

export function polarCheckoutHref(
  sku: LicenseSku,
  term: LicenseTerm,
  extras?: { email?: string; company?: string; website?: string }
): string {
  if (!isPaidLicense(sku.id)) return PERSONAL_SELFHOST_HREF
  const params = new URLSearchParams({ sku: sku.id, term })
  if (extras?.email) params.set('email', extras.email)
  if (extras?.company) params.set('company', extras.company)
  if (extras?.website) params.set('website', extras.website)
  return `${LICENSE_HOOKS_ORIGIN}/checkout/license?${params}`
}

export function licenseLookupHref(query?: string): string {
  const url = `${LICENSE_HOOKS_ORIGIN}/licenses/lookup`
  if (!query) return url
  return `${url}?q=${encodeURIComponent(query)}`
}

export function licenseRegisterApiHref(): string {
  return `${LICENSE_HOOKS_ORIGIN}/licenses/register`
}

export function invoiceMailto(sku: LicenseSku, term: LicenseTerm): string {
  if (!isPaidLicense(sku.id)) return PERSONAL_SELFHOST_HREF
  const price = licensePriceUsd(sku, term)
  const subject = encodeURIComponent(
    `chmonitor ${sku.name} ${term} license ($${price})`
  )
  const body = encodeURIComponent(
    [
      `I would like to buy a chmonitor ${sku.name} ${term} license.`,
      '',
      `SKU: ${sku.id}`,
      `Term: ${term}`,
      `Price: $${price} USD`,
      `Hosts: ${sku.hosts === null ? 'unlimited' : sku.hosts}`,
      '',
      'Company name:',
      'Website:',
      'Billing email:',
      'List us on the public customers page? yes / no',
    ].join('\n')
  )
  return `mailto:${LICENSE_SALES_EMAIL}?subject=${subject}&body=${body}`
}

/** Slack/email paste for the engineer who needs a signature. */
export const bossPitch = `Subject: $499 so I stop SSHing into ClickHouse at 2am

Hi —

I already run chmonitor next to our ClickHouse. GPL-3.0, self-hosted, no license key, no SaaS, no phoning home.

The Team license is $499/year for 3 hosts ($1,349 lifetime if finance hates renewals). Unlimited is $999/year. Polar takes the card; they email the receipt. There is nothing to paste into the app.

What we get: a commercial invoice, priority email, and I stop writing Grafana panels that lie about system.parts.

That's cheaper than one incident where someone asks "why is the merge queue 400" and I open eleven browser tabs.

Please approve. I'll buy it here: https://chmonitor.dev/pricing/

Thanks`

export const licenseFaqs = [
  {
    q: 'The software is already free. Why buy a license?',
    a: 'The GPL-3.0 build stays free and unrestricted. A license is a commercial agreement for teams that need an invoice, a named vendor, and email support — and it funds ongoing development. We do not lock features behind a key.',
  },
  {
    q: 'Do I need a license key in the binary?',
    a: 'No. After you pay, you register your company name and website. We trust you. There is no DRM, no nag screen, and no phone-home license check.',
  },
  {
    q: 'What is a host?',
    a: 'A host is one monitored connection — one ClickHouse cluster endpoint, or (beta) one Postgres database. A detected replica in the same shard counts as 0.5 host.',
  },
  {
    q: 'Yearly vs lifetime?',
    a: 'Yearly is a 12-month commercial license and support window. Lifetime is a one-time payment that covers that host count for as long as the product exists. Lifetime does not include a support SLA after the first year; email us if you want a support add-on.',
  },
  {
    q: 'Can we stay private?',
    a: 'Yes. Listing on the customers page is opt-in. Default is private.',
  },
  {
    q: 'What about the hosted cloud?',
    a: 'dash.chmonitor.dev remains available if you do not want to run the app. Most operators who already self-host ClickHouse should run chmonitor next to it and buy a license instead.',
  },
  {
    q: 'Need a PO or vendor form?',
    a: `Buy on Polar from the pricing page. For a PO or Net-30 invoice, email ${LICENSE_SALES_EMAIL}.`,
  },
  {
    q: 'Where do I paste the license key?',
    a: 'You do not. There is no key. Polar emails the payment receipt. Register your company after pay, or look up the order with the Polar checkout id / billing email. The app never asks for a key.',
  },
  {
    q: 'Who emails me after I pay?',
    a: 'Polar sends the receipt. We (hello@chmonitor.dev) only write if you asked for a PO or if lookup cannot find the order.',
  },
]
