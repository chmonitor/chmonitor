import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const landing = join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(join(landing, rel), 'utf8')

const base = read('src/layouts/Base.astro')
const navCss = read('src/styles/nav.css')
const nav = read('src/components/Nav.astro')
const hero = read('src/components/Hero.astro')
const homeCmp = read('src/components/Comparison.astro')
const vsCmp = read('src/components/ComparisonTable.astro')
const dbCmp = read('src/components/DbComparisonTable.astro')
const buttons = read('src/lib/button-classes.ts')

/** CSS after the closing of `@layer base { ... }` — unlayered, beats Tailwind. */
function unlayeredCss(src: string): string {
  const start = src.indexOf('@layer base {')
  expect(start).toBeGreaterThan(-1)
  let depth = 0
  for (let i = start + '@layer base {'.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(i + 1)
    }
  }
  throw new Error('unclosed @layer base')
}

describe('mobile nav: desktop CTAs must not fight Tailwind', () => {
  test('shared button classes still use inline-flex (the specificity trap)', () => {
    expect(buttons).toContain('inline-flex')
  })

  test('desktop GitHub + Dashboard CTAs live in .nav-cta-desktop, not as loose .nav-cta > a', () => {
    expect(nav).toContain('class="nav-cta-desktop"')
    const desktop = nav.split('nav-cta-desktop')[1] ?? ''
    expect(desktop).toContain('dash.chmonitor.dev')
    expect(desktop).toContain('github.com/chmonitor/chmonitor')
    expect(desktop.indexOf('nav-toggle')).toBeGreaterThan(
      desktop.indexOf('Dashboard')
    )
  })

  test('Dashboard stays reachable in the drawer', () => {
    expect(nav).toContain('nav-drawer-foot')
    const foot = nav.split('nav-drawer-foot')[1] ?? ''
    expect(foot).toContain('dash.chmonitor.dev')
    expect(foot).toContain('Dashboard')
  })

  test('unlayered CSS hides the CTA wrapper at ≤1024px (beats inline-flex)', () => {
    expect(navCss).toMatch(
      /@media \(max-width:\s*1024px\)[\s\S]*?\.nav-cta-desktop\s*\{[\s\S]*?display:\s*none/
    )
    expect(navCss).not.toMatch(/\.nav-cta\s*>\s*a\s*\{[^}]*display:\s*none/)
  })
})

describe('mobile nav: open menu shows X + dim, tap targets ≥44px', () => {
  test('hamburger swaps .i-open / .i-close on aria-expanded', () => {
    expect(nav).toContain('class="i-open"')
    expect(nav).toContain('class="i-close"')
    expect(navCss).toContain(
      ".nav-toggle[aria-expanded='true'] .i-close"
    )
    expect(nav).toContain('class="nav-drawer-backdrop"')
  })

  test('header stacks above the drawer so the X is not covered', () => {
    expect(navCss).toMatch(/header\.nav\s*\{[\s\S]*?z-index:\s*80/)
    expect(navCss).toMatch(/\.nav-drawer\s*\{[\s\S]*?z-index:\s*70/)
  })

  test('open drawer dims the page and leaves a visible backdrop strip', () => {
    expect(navCss).toContain('rgba(9, 9, 11, 0.56)')
    expect(navCss).toContain('calc(100vw - 56px)')
    expect(navCss).toContain('pointer-events: auto')
  })

  test('phone chrome tap targets are 44px at the hamburger breakpoint', () => {
    expect(navCss).toMatch(
      /@media \(max-width:\s*1024px\)[\s\S]*?\.nav-toggle\s*\{[\s\S]*?width:\s*44px/
    )
    expect(navCss).toMatch(
      /@media \(max-width:\s*1024px\)[\s\S]*?\.theme-toggle\s*\{[\s\S]*?width:\s*44px/
    )
    expect(navCss).toContain('min-height: 44px')
  })
})

describe('hero latest-post pill: title + arrow, truncates when tight', () => {
  test('shows the post title and a trailing arrow, no New prefix', () => {
    const idx = hero.indexOf('data-hero-latest-post')
    expect(idx).toBeGreaterThan(-1)
    const start = hero.lastIndexOf('<a', idx)
    const pill = hero.slice(start, hero.indexOf('</a>', idx))
    expect(pill).toContain('{latestPost.title}')
    expect(pill).toContain('{latestPost.href}')
    expect(pill).toContain('title={latestPost.title}')
    expect(pill).toContain('truncate')
    expect(pill).toContain('shrink-0')
    expect(pill).not.toMatch(/>New</)
    expect(pill).not.toContain('sparkSvg')
  })

  test('type is at least 12px (text-xs), not a squeeze below that', () => {
    const latest = hero.split('data-hero-latest-post')[1] ?? ''
    const pill = latest.slice(0, latest.indexOf('</a>'))
    expect(pill).toContain('text-xs')
    expect(pill).not.toMatch(/text-\[(?:9|10|11)px\]/)
  })
})

describe('comparison matrices: readable on 375 / 768 without page overflow-x', () => {
  test('homepage + vs + db tables share .cmp-matrix and drop min-w-[640px]', () => {
    expect(homeCmp).toContain('cmp-matrix cmp-matrix--tools')
    expect(vsCmp).toContain('class="reveal cmp-matrix')
    expect(dbCmp).toContain('class="reveal cmp-matrix')
    expect(homeCmp).not.toContain('min-w-[640px]')
    expect(vsCmp).not.toContain('min-w-[640px]')
    expect(dbCmp).not.toContain('min-w-[640px]')
  })

  test('vs/db cells keep column meaning via data-label when stacked', () => {
    expect(vsCmp).toContain('data-label="chmonitor"')
    expect(vsCmp).toContain('data-label={competitor}')
    expect(dbCmp).toContain('data-label={subjects[i]}')
  })

  test('unlayered CSS stacks the matrix at ≤768 and uses readable cell color', () => {
    const extra = unlayeredCss(base)
    expect(extra).toMatch(/@media \(max-width:768px\)/)
    expect(extra).toContain('.cmp-matrix table{min-width:0;width:100%}')
    expect(extra).toContain(
      '.cmp-matrix tbody,.cmp-matrix tr,.cmp-matrix th,.cmp-matrix td{display:block;width:100%}'
    )
    expect(extra).toContain('.cmp-matrix td{color:var(--fg-soft)}')
    expect(extra).toContain('content:attr(data-label)')
    expect(extra).toContain('.cmp-matrix--tools td:nth-child(2)::before')
  })
})
