import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const shared = readFileSync(join(root, 'shared.ts'), 'utf8')
const layout = readFileSync(join(root, 'layout.shared.tsx'), 'utf8')
const article = readFileSync(join(root, '../routes/$.tsx'), 'utf8')
const home = readFileSync(join(root, '../routes/index.tsx'), 'utf8')
const footer = readFileSync(join(root, '../components/sidebar-footer.tsx'), 'utf8')

describe('docs Home + Dashboard CTAs', () => {
  test('shared constants point at marketing site and dashboard', () => {
    assert.match(shared, /export const marketingUrl = 'https:\/\/chmonitor\.dev'/)
    assert.match(
      shared,
      /export const dashboardUrl = 'https:\/\/dash\.chmonitor\.dev'/
    )
  })

  test('header nav includes Home and Dashboard as external nav-only links', () => {
    assert.match(layout, /text: 'Home'/)
    assert.match(layout, /url: marketingUrl/)
    assert.match(layout, /text: 'Dashboard'/)
    assert.match(layout, /url: dashboardUrl/)
    assert.match(layout, /external: true/)
    assert.match(layout, /on: 'nav'/)
    assert.match(layout, /links: \[\.\.\.siteCtaLinks, \.\.\.sectionLinks\]/)
  })

  test('docs home and article layouts use shared baseOptions', () => {
    assert.match(home, /HomeLayout \{\.\.\.baseOptions\(\)\}/)
    assert.match(article, /\{\.\.\.baseOptions\(\)\}/)
    assert.doesNotMatch(article, /links=\{\[\]\}/)
  })

  test('sidebar footer offers Home and Open Dashboard', () => {
    assert.match(footer, /href=\{marketingUrl\}/)
    assert.match(footer, />Home</)
    assert.match(footer, /href=\{dashboardUrl\}/)
    assert.match(footer, />Open Dashboard</)
  })
})
