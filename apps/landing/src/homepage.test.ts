import { getLatestBlogPost } from './lib/latest-blog-post'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const landing = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(landing, rel), 'utf8')

const home = read('src/pages/index.astro')
const nav = read('src/components/Nav.astro')
const footer = read('src/components/Footer.astro')
const baseLayout = read('src/layouts/Base.astro')
const hero = read('src/components/Hero.astro')
const showcase = read('src/components/FeatureShowcase.astro')
const featurePage = read('src/pages/features/[slug].astro')

describe('homepage hides Pricing and the Always shipping band', () => {
  test('does not import or render Pricing or ChangelogBand', () => {
    expect(home).not.toContain("from '../components/Pricing.astro'")
    expect(home).not.toContain("from '../components/ChangelogBand.astro'")
    expect(home).not.toMatch(/<Pricing\b/)
    expect(home).not.toMatch(/<ChangelogBand\b/)
  })

  test('keeps FAQ and the dedicated pages/components', () => {
    expect(home).toContain('<FAQ />')
    expect(existsSync(join(landing, 'src/pages/pricing.astro'))).toBe(true)
    expect(existsSync(join(landing, 'src/pages/changelog.astro'))).toBe(true)
    expect(existsSync(join(landing, 'src/components/Pricing.astro'))).toBe(true)
    expect(
      existsSync(join(landing, 'src/components/ChangelogBand.astro'))
    ).toBe(true)
  })
})

describe('header nav advertises Pricing', () => {
  test('desktop and mobile chrome link to /pricing', () => {
    expect(nav).toContain("to('/pricing')")
    expect(nav).toMatch(/>Pricing</)
  })

  test('Changelog still links to /changelog', () => {
    expect(nav).toContain("to('/changelog')")
  })

  test('CLI is listed under Features, not as a top-level item', () => {
    expect(nav).toContain("to('/cli')")
    expect(nav).toContain('featureIcons.cli')
    expect(nav).toContain(
      'nav-item-label">CLI<span class="nav-badge">Beta</span>'
    )
    expect(nav).not.toMatch(
      /to\('\/customers'\)\}>Customers<\/a>\s*<a href=\{to\('\/cli'\)\}>CLI<\/a>/
    )
    expect(footer).toContain("to('/cli')")
  })

  test('Nav can prefix on-site paths for the blog', () => {
    expect(nav).toContain('origin?: string')
    expect(nav).toContain('const to = (path: string) =>')
    expect(baseLayout).toContain("import '../styles/nav.css'")
  })

  test('footer still links to /pricing', () => {
    expect(footer).toContain("to('/pricing')")
  })

  test('Footer can prefix on-site paths for the blog', () => {
    expect(footer).toContain('origin?: string')
    expect(footer).toContain('const to = (path: string) =>')
  })
})

describe('hero pill links to the latest Release or Update post', () => {
  const latest = getLatestBlogPost()

  test('helper resolves a published post on blog.chmonitor.dev', () => {
    expect(latest).not.toBeNull()
    expect(latest!.href).toContain('blog.chmonitor.dev')
    expect(latest!.href).toBe(`https://blog.chmonitor.dev/${latest!.slug}/`)
    expect(latest!.title.length).toBeGreaterThan(0)
  })

  test('hero source renders that post via the helper (not a hardcoded slug)', () => {
    expect(hero).toContain("from '../lib/latest-blog-post'")
    expect(hero).toContain('getLatestBlogPost')
    expect(hero).toContain('data-hero-latest-post')
    expect(hero).toContain('href={latestPost.href}')
    expect(hero).toContain('{latestPost.title}')
    expect(hero).toContain('truncate')
    expect(hero).not.toMatch(/>New</)
    expect(hero).not.toContain('data-hero-oss')
    expect(hero).not.toContain('https://github.com/chmonitor/chmonitor')
  })
})

describe('feature sections have no 01 / 08 index labels', () => {
  test('homepage showcase does not number every block', () => {
    expect(showcase).not.toContain('padStart')
    expect(showcase).not.toContain('FEATURE_SECTIONS.length).padStart')
  })

  test('feature pages keep the eyebrow without a 01 · prefix', () => {
    expect(featurePage).toContain('{section.eyebrow}')
    expect(featurePage).not.toContain('padStart')
  })
})

describe('hero video', () => {
  test('links to the dedicated watch page', () => {
    expect(hero).toContain('data-hero-watch-page')
    expect(hero).toContain('href="/watch/v0-3"')
    expect(existsSync(join(landing, 'src/pages/watch/v0-3.astro'))).toBe(true)
  })

  test('autoplays muted and loops', () => {
    const idx = hero.indexOf('data-hero-intro')
    expect(idx).toBeGreaterThan(-1)
    const start = hero.lastIndexOf('<video', idx)
    const tag = hero.slice(start, hero.indexOf('>', idx))
    expect(tag).toMatch(/\bautoplay\b/)
    expect(tag).toMatch(/\bmuted\b/)
    expect(tag).toMatch(/\bloop\b/)
  })
})
