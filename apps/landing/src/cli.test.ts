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
const redirects = read('public/_redirects')
const pkg = read('package.json')

describe('/cli landing page', () => {
  test('intro, features, and one install command', () => {
    expect(page).toContain('chmonitor from the terminal')
    expect(page).toContain(
      'chmonitor talks straight to your chmonitor dashboard. Ready for AI Agents.'
    )
    expect(page).toContain('id="install"')
    expect(page).toContain('{CLI_INSTALL}')
    expect(data).toContain(
      'curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash'
    )
    expect(data).toContain("title: 'Your dashboard'")
    expect(data).toContain("title: 'Ready for AI agents'")
    expect(data).toContain("title: 'Interactive TUI'")
  })

  test('embeds an interactive sample of the TUI', () => {
    const demo = read('src/components/CliDemo.astro')
    expect(page).toContain("from '../components/CliDemo.astro'")
    expect(page).toContain('<CliDemo />')
    expect(demo).toContain('data-cli-demo')
    expect(demo).toContain('data-scene="tui"')
    expect(demo).toContain('data-scene="dashboards"')
    expect(demo).toContain('data-scene="config"')
    expect(demo).toContain('data-scene="agent"')
    expect(demo).toContain('Sample')
  })

  test('does not advertise beta or cargo install on /cli', () => {
    expect(page).not.toContain('CLI_INSTALL_BETA')
    expect(page).not.toContain('CLI_CARGO')
    expect(data).not.toContain('CHM_CHANNEL=beta')
    expect(data).not.toContain('cargo install')
    expect(redirects).not.toContain('/install.sh')
  })

  test('build copies scripts/install.sh for browser /install.sh', () => {
    expect(pkg).toContain('sync-landing-install.mjs')
    expect(
      existsSync(join(landing, '../../scripts/sync-landing-install.mjs'))
    ).toBe(true)
    expect(existsSync(join(landing, '../../scripts/install.sh'))).toBe(true)
  })

  test('nav Features menu and footer link to /cli', () => {
    expect(nav).toContain("to('/cli')")
    expect(footer).toContain('href="/cli"')
  })

  test('OG card is wired', () => {
    expect(page).toContain('image="/og/og-cli.png"')
    expect(og).toContain("file: 'og-cli.png'")
    expect(og).toContain('chmonitor from')
  })
})
