import { pricingFaqs } from './pricing'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cloudSignup = join(
  import.meta.dir,
  '../../../../docs/content/guide/getting-started/cloud-signup.mdx'
)

describe('pricing FAQ is self-host licenses, not Cloud seats', () => {
  test('does not present Free/Pro/Max AI caps as license-plan facts', () => {
    const hay = pricingFaqs.map((f) => `${f.q}\n${f.a}`).join('\n')
    expect(hay).not.toMatch(/Free 5/)
    expect(hay).not.toMatch(/Pro 100/)
    expect(hay).not.toMatch(/Max 1,?000/)
    expect(hay).not.toMatch(/\$5 per 2,?000/)
    expect(hay.toLowerCase()).toMatch(/self-host/)
    expect(hay.toLowerCase()).toMatch(/hosted cloud/)
  })

  test('Cloud AI caps live on the Cloud sign-up docs with env numbers', () => {
    const src = readFileSync(cloudSignup, 'utf8')
    expect(src).toMatch(/hosted Cloud only/i)
    expect(src).toContain('CHM_GUEST_AI_REQUESTS_PER_DAY')
    expect(src).toMatch(/\*\*3\*\*/)
    expect(src).toMatch(/\*\*5\*\*/)
    expect(src).toMatch(/\*\*100\*\*/)
    expect(src).toMatch(/\*\*1,000\*\*/)
    expect(src).toContain('$5 per 2,000')
    expect(src).toMatch(/Self-host OSS is \*\*not\*\* gated/)
  })
})
