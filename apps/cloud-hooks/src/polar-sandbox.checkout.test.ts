/**
 * Live Polar sandbox: create a checkout the same way GET /checkout/license
 * does (business customer + billing address so tax is computed after country).
 *
 * Skips unless POLAR_SANDBOX_ACCESS_TOKEN (or POLAR_ACCESS_TOKEN) and a
 * sandbox product id are set. Never logs the token.
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadLocalEnv(file: string) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
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
    if (process.env[key] === undefined) process.env[key] = val
  }
}

const root = join(import.meta.dir, '..')
loadLocalEnv(join(root, '.env.local'))
loadLocalEnv(join(root, '.env.production.local'))
loadLocalEnv(join(root, '../../apps/dashboard/.env.production.local'))

const token = (
  process.env.POLAR_SANDBOX_ACCESS_TOKEN ||
  process.env.POLAR_ACCESS_TOKEN ||
  ''
).trim()
const productId = (
  process.env.POLAR_SANDBOX_PRODUCT_ID ||
  process.env.CHM_POLAR_LICENSE_TEAM_YEARLY ||
  ''
).trim()
const live = Boolean(token && productId && !token.startsWith('polar_test'))

describe('Polar sandbox checkout (live)', () => {
  test.skipIf(!live)(
    'creates an open checkout with tax-ready billing flags',
    async () => {
      const res = await fetch('https://sandbox-api.polar.sh/v1/checkouts/', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          products: [productId],
          success_url:
            'https://chmonitor.dev/license/register?sku=team&term=yearly&paid=1&checkout_id={CHECKOUT_ID}',
          customer_email: 'sandbox-test@chmonitor.dev',
          customer_name: 'Sandbox Checkout Test',
          is_business_customer: true,
          require_billing_address: true,
          metadata: {
            kind: 'selfhost-license',
            sku: 'team',
            term: 'yearly',
            company: 'Sandbox Checkout Test',
          },
        }),
      })
      const json = (await res.json()) as {
        id?: string
        url?: string
        status?: string
        error?: string
        detail?: unknown
      }
      expect(res.ok, JSON.stringify(json).slice(0, 400)).toBe(true)
      expect(json.id).toBeTruthy()
      expect(json.url).toMatch(/^https:\/\/(sandbox\.)?polar\.sh\//)
      expect(json.status === undefined || json.status === 'open').toBe(true)
    }
  )

  test('documents skip when sandbox credentials are absent', () => {
    if (live) return
    expect(live).toBe(false)
  })
})
