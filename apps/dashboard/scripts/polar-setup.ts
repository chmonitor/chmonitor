/**
 * Create Polar self-host license products and archive leftover Cloud SKUs.
 *
 * Usage (from apps/dashboard):
 *   bun scripts/polar-setup.ts
 *
 * Loads POLAR_ACCESS_TOKEN from process.env, then
 * apps/dashboard/.env.local (canonical), then repo-root .env.local
 * (root-script fallback). Re-running matches
 * existing license products by name. Always archives leftover Cloud
 * Free/Pro/Max products so the Polar catalog stays licenses only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type LicenseTerm,
  licensePolarPriceCents,
  licensePolarProductEnvKey,
  licensePolarProductName,
  PAID_LICENSE_IDS,
  type PaidLicenseId,
} from '@chm/pricing'
import { Polar } from '@polar-sh/sdk'

const here = dirname(fileURLToPath(import.meta.url))
const dashboardRoot = join(here, '..')
const repoRoot = join(dashboardRoot, '../..')
const DASH_ENV_LOCAL = join(dashboardRoot, '.env.local')

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val
    }
  }
}

// First non-empty wins. Dashboard files own Polar + catalog; root .env.local
// is a fallback for tokens when a script is run from the git root.
for (const path of [
  DASH_ENV_LOCAL,
  join(dashboardRoot, '.env.production.local'),
  join(dashboardRoot, '.env.production'),
  join(repoRoot, '.env.local'),
]) {
  loadEnvFile(path)
}

const token = process.env.POLAR_ACCESS_TOKEN
if (!token) {
  console.error(
    'POLAR_ACCESS_TOKEN is required. Put it in apps/dashboard/.env.local (gitignored).'
  )
  process.exit(1)
}
const server =
  process.env.CHM_POLAR_SERVER === 'production' ? 'production' : 'sandbox'

const polar = new Polar({ accessToken: token, server })

const args = new Set(process.argv.slice(2))
const archiveOld = !args.has('--keep-archived-cloud')

/** Old hosted Cloud catalog names from the previous polar-setup. */
const OLD_CLOUD_PRODUCT_NAMES = new Set([
  'chmonitor Free',
  'chmonitor Pro (Monthly)',
  'chmonitor Pro (Yearly)',
  'chmonitor Max (Monthly)',
  'chmonitor Max (Yearly)',
  'chmonitor Fleet (Monthly)',
  'chmonitor Fleet (Yearly)',
  'chmonitor Enterprise',
])

function isLicenseProductName(name: string): boolean {
  return / License \((Yearly|Lifetime)\)$/.test(name)
}

async function listExistingProducts(): Promise<
  { id: string; name: string; isArchived?: boolean }[]
> {
  const items: { id: string; name: string; isArchived?: boolean }[] = []
  const pages = await polar.products.list({ limit: 100, isArchived: false })
  for await (const page of pages) {
    for (const product of page.result.items) {
      items.push({
        id: product.id,
        name: product.name,
        isArchived: product.isArchived,
      })
    }
  }
  return items
}

async function archiveOldCloudProducts(
  products: { id: string; name: string }[]
): Promise<void> {
  for (const product of products) {
    if (isLicenseProductName(product.name)) continue
    const known = OLD_CLOUD_PRODUCT_NAMES.has(product.name)
    const looksCloud = /^chmonitor (Free|Pro|Max|Fleet|Enterprise)\b/.test(
      product.name
    )
    if (!known && !looksCloud) continue
    await polar.products.update({
      id: product.id,
      productUpdate: { isArchived: true },
    })
    console.log(`- archive ${product.name} → ${product.id}`)
  }
}

async function ensureLicenseProduct(
  sku: PaidLicenseId,
  term: LicenseTerm,
  existing: Map<string, string>
): Promise<{ envKey: string; id: string }> {
  const name = licensePolarProductName(sku, term)
  const envKey = licensePolarProductEnvKey(sku, term)
  const found = existing.get(name)
  if (found) {
    console.log(`= reuse  ${name} → ${found}`)
    return { envKey, id: found }
  }
  const body: {
    name: string
    prices: Array<{
      amountType: 'fixed'
      priceAmount: number
      priceCurrency: 'usd'
    }>
    recurringInterval?: 'year'
  } = {
    name,
    prices: [
      {
        amountType: 'fixed',
        priceAmount: licensePolarPriceCents(sku, term),
        priceCurrency: 'usd',
      },
    ],
  }
  if (term === 'yearly') body.recurringInterval = 'year'
  const created = await polar.products.create(body)
  console.log(`+ create ${name} → ${created.id}`)
  return { envKey, id: created.id }
}

async function main() {
  console.log(
    `Polar setup (server=${server}${archiveOld ? ', archive leftover Cloud SKUs' : ''})\n`
  )
  const listed = await listExistingProducts()
  if (archiveOld) await archiveOldCloudProducts(listed)
  const existing = new Map(listed.map((p) => [p.name, p.id]))
  // Re-list after archive so reuse map stays current.
  for (const p of await listExistingProducts()) existing.set(p.name, p.id)

  const lines: string[] = []
  for (const sku of PAID_LICENSE_IDS) {
    for (const term of ['yearly', 'lifetime'] as const) {
      const { envKey, id } = await ensureLicenseProduct(sku, term, existing)
      lines.push(`${envKey}=${id}`)
    }
  }
  console.log(
    '\n# Paste into apps/dashboard/.env.production (or .env.production.local):'
  )
  console.log(lines.join('\n'))

  const licenseLines = lines.filter((l) => l.startsWith('CHM_POLAR_LICENSE_'))
  if (licenseLines.length) upsertEnvLocal(DASH_ENV_LOCAL, licenseLines)
}

function upsertEnvLocal(path: string, lines: string[]): void {
  const incoming = new Map(
    lines.map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l] as const
    })
  )
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const kept = existing.split('\n').filter((row) => {
    const key = row.split('=')[0]?.trim()
    return !key || !incoming.has(key)
  })
  while (kept.length && kept[kept.length - 1] === '') kept.pop()
  const block = [
    '',
    '# Self-host Polar licenses (from scripts/polar-setup.ts)',
    ...incoming.values(),
    '',
  ]
  writeFileSync(path, `${kept.join('\n')}${block.join('\n')}`)
  console.log(`\nWrote ${incoming.size} CHM_POLAR_LICENSE_* keys to ${path}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
