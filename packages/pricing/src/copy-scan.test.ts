import { SPONSOR_TIERS } from './sponsors'
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../../..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')

/**
 * The released version, from the one file release-please bumps on every release.
 *
 * The root `package.json` looks like the answer and is not: release-please is
 * configured with `release-type: simple` for `.`, which writes the manifest,
 * CHANGELOG.md, and apps/dashboard's package.json — and never the root one. So
 * the root "version" is a vestigial 0.3.0 and reading it is how the README ended
 * up claiming a release that had not shipped for months.
 */
const releasedVersion: string = JSON.parse(
  readFileSync(join(root, '.github/.release-please-manifest.json'), 'utf8')
)['.']

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

describe('the README sponsor table', () => {
  test('every tier is listed with its real amount and its real pitch', () => {
    // The README is hand-written, the tiers are the source of truth. Pin the
    // whole row, not just the price: a renamed tier or a reworded pitch is the
    // drift a reader would actually see on GitHub.
    for (const tier of SPONSOR_TIERS) {
      expect(readme, tier.id).toContain(
        `| ${tier.label} | $${tier.amountUsd} |`
      )
      expect(readme, tier.id).toContain(tier.pitch.replace(/\.$/, ''))
    }
    expect(readme).not.toMatch(/\bPolar\b/)
  })

  test('the hero slot threshold is stated, so the price cannot drift quietly', () => {
    // The table is pinned row by row, but the prose also names the threshold —
    // a rung that moves the hero flag must move that sentence too.
    const hero = SPONSOR_TIERS.find((tier) => tier.hero)
    expect(hero).toBeDefined()
    expect(readme).toContain(
      `or $${hero?.amountUsd} to put your logo under the homepage hero`
    )
  })

  test('it links to the offer and the wall, like the homepage hero does', () => {
    expect(readme).toContain('https://chmonitor.dev/license#sponsor')
    expect(readme).toContain('https://chmonitor.dev/sponsors')
    expect(readme).toContain('Start sponsoring')
  })
})

describe('the README release pointer', () => {
  // This is the "stays true on the next release" guard. A hard-coded version in
  // a hand-written README is stale the moment release-please cuts the next tag;
  // pinning it to the manifest turns that into a failing check the release PR
  // has to answer, instead of a claim nobody notices is wrong.
  const hint =
    `Update README.md to the released version ${releasedVersion}: ` +
    `releases/tag/v${releasedVersion} and ghcr.io/chmonitor/chmonitor:${releasedVersion}`

  test('the prose points at the release that actually shipped', () => {
    expect(readme, hint).toContain(`releases/tag/v${releasedVersion}`)
  })

  test('the quick start pulls a tag that exists', () => {
    // The image tag has NO `v`: release.yml computes VERSION="${TAG#v}" and
    // pushes that raw, so v0.3.6 is a 404 while 0.3.6 resolves. Asserting the
    // form here is what stops the v-prefixed typo coming back.
    expect(readme, hint).toContain(
      `ghcr.io/chmonitor/chmonitor:${releasedVersion}`
    )
    expect(readme, hint).not.toContain(
      `ghcr.io/chmonitor/chmonitor:v${releasedVersion}`
    )
    // No other pinned image tag may sit in the README either.
    for (const [, tag] of readme.matchAll(
      /ghcr\.io\/chmonitor\/chmonitor:v([\d.]+)/g
    )) {
      expect(tag, `${hint} (found a v-prefixed tag: v${tag})`).not.toBe(
        releasedVersion
      )
    }
  })

  test('no version is pinned that is older than the release', () => {
    // Catches the other direction: a README still pointing at v0.3.0 after
    // 0.3.6 shipped, even if the tag list happens to pass above.
    const pinned = [...readme.matchAll(/releases\/tag\/v(\d+\.\d+\.\d+)/g)].map(
      ([, v]) => v
    )
    expect(pinned.length, hint).toBeGreaterThan(0)
    for (const version of pinned) {
      expect(
        version === releasedVersion,
        `${hint} (README pins v${version})`
      ).toBe(true)
    }
  })
})

describe('published image tags resolve', () => {
  /**
   * release.yml computes `VERSION="${TAG#v}"` and pushes that with
   * `type=raw,value=...`, so the registry has never held a `v`-prefixed image
   * tag. Verified against GHCR while fixing this: v0.3.6 -> 404, 0.3.6 -> 200;
   * v0.3.1 / v0.3.3 / v0.3.4 -> 404 while 0.3.1 / 0.3.3 / 0.3.4 all -> 200.
   *
   * A `v` in a tag is therefore not a style question — it is a failed
   * `docker pull`, in a quick start people copy verbatim and in one-click
   * templates a platform pulls for them. This walks the tree so a new page or
   * template cannot reintroduce it.
   */
  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) yield* walk(full)
      else yield full
    }
  }

  const scanned = [
    ...walk(join(root, 'docs/content')),
    ...walk(join(root, 'deploy/templates')),
  ].filter((file) => /\.(mdx|md|toml|ya?ml|json)$/.test(file))

  test('nothing v-prefixed survives in docs or deploy templates', () => {
    expect(scanned.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8')
      for (const [, tag] of text.matchAll(/chmonitor\/chmonitor:v([\w.]+)/g)) {
        offenders.push(`${file.slice(root.length + 1)} -> v${tag}`)
      }
    }
    expect(
      offenders,
      `Drop the v: the image tag is ${releasedVersion}, not v${releasedVersion}. Found:\n` +
        offenders.join('\n')
    ).toEqual([])
  })

  test('no doc links the retired /pricing page', () => {
    // pricing.astro is a 301 to /license, so a /pricing link is a redirect hop
    // that will one day have nothing to redirect to.
    const offenders: string[] = []
    for (const file of scanned) {
      if (readFileSync(file, 'utf8').includes('chmonitor.dev/pricing')) {
        offenders.push(file.slice(root.length + 1))
      }
    }
    expect(
      offenders,
      `Use chmonitor.dev/license:\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
