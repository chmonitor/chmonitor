import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')

const userFacing = [
  'apps/landing/src/data/licenses.ts',
  'apps/landing/src/data/pricing.ts',
  'apps/landing/src/components/Pricing.astro',
  'apps/landing/src/pages/pricing.astro',
  'apps/landing/src/pages/license/register.astro',
  'apps/landing/src/pages/customers.astro',
  'docs/content/operate/advanced/commercial-license.mdx',
  'docs/content/reference/faq.mdx',
  'apps/blog/src/content/blog/self-hosted-licenses.md',
  'README.md',
]

describe('user-facing license copy', () => {
  test('does not offer Solo or Fleet as license SKUs', () => {
    for (const rel of userFacing) {
      const text = readFileSync(join(root, rel), 'utf8')
      expect(text, rel).not.toMatch(/\| Solo \|/)
      expect(text, rel).not.toMatch(/Solo 1/)
      expect(text, rel).not.toMatch(/Fleet 10/)
      expect(text, rel).not.toMatch(/\$199 \/ \$599/)
      expect(text, rel).not.toMatch(/\$449 \/ \$1,349/)
    }
  })

  test('commercial docs and blog state the three-tier prices', () => {
    const docs = readFileSync(
      join(root, 'docs/content/operate/advanced/commercial-license.mdx'),
      'utf8'
    )
    const blog = readFileSync(
      join(root, 'apps/blog/src/content/blog/self-hosted-licenses.md'),
      'utf8'
    )
    for (const text of [docs, blog]) {
      expect(text).toContain('Personal Self Hosted')
      expect(text).toContain('$499')
      expect(text).toContain('$1,349')
      expect(text).toContain('$999')
      expect(text).toContain('$2,999')
      // honor system, or its plainer wording ("we trust you on host count")
      expect(text.toLowerCase()).toMatch(/honor|trust you/)
      expect(text.toLowerCase()).toContain('opt')
    }
  })
})
