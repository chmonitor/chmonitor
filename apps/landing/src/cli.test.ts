import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const landing = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(landing, rel), 'utf8')

const page = read('src/pages/cli.astro')
const data = read('src/data/cli.ts')
const nav = read('src/components/Nav.astro')
const footer = read('src/components/Footer.astro')
const og = read('scripts/build-og.ts')
const analytics = read('src/lib/analytics.ts')
const base = read('src/layouts/Base.astro')

describe('/cli landing page', () => {
  test('page and copy exist', () => {
    expect(existsSync(join(landing, 'src/pages/cli.astro'))).toBe(true)
    expect(page).toContain("image=\"/og/og-cli.png\"")
    expect(page).toContain('chm diagnose')
    expect(data).toContain('curl -sSf https://chmonitor.dev/install.sh | bash')
    expect(data).toContain('cargo install chmonitor')
  })

  test('install uses the landing installer, not a raw GitHub URL', () => {
    expect(data).toContain('https://chmonitor.dev/install.sh')
    expect(data).not.toContain('raw.githubusercontent.com')
  })

  test('nav Features menu and footer link to /cli', () => {
    expect(nav).toContain("to('/cli')")
    expect(nav).toContain('featureIcons.cli')
    expect(footer).toContain('href="/cli"')
  })

  test('OG card and analytics event are wired', () => {
    expect(og).toContain("file: 'og-cli.png'")
    expect(analytics).toContain("'cli_view'")
    expect(base).toContain("path === '/cli'")
    expect(base).toContain("trackEvent('cli_view')")
  })

  test('terminal copy is not gated on the homepage deploy section', () => {
    expect(base).toContain("document.querySelectorAll('.terminal .copy')")
    expect(base).not.toContain('section.querySelectorAll(\'.terminal .copy\')')
  })
})
