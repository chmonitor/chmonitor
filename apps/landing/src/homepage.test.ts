import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const landing = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(landing, rel), 'utf8')

const home = read('src/pages/index.astro')
const nav = read('src/components/Nav.astro')
const footer = read('src/components/Footer.astro')

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

describe('header nav does not advertise Pricing', () => {
  test('desktop and mobile chrome have no /pricing item', () => {
    expect(nav).not.toContain('href="/pricing"')
    expect(nav).not.toMatch(/>Pricing</)
  })

  test('Changelog still links to /changelog', () => {
    expect(nav).toContain('href="/changelog"')
  })

  test('footer still links to /pricing', () => {
    expect(footer).toContain('href="/pricing"')
  })
})
