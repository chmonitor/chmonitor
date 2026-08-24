import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const blog = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(blog, rel), 'utf8')

describe('blog chrome matches landing shadcn tokens', () => {
  test('Base imports the new globals.css', () => {
    expect(existsSync(join(blog, 'src/styles/globals.css'))).toBe(true)
    expect(read('src/layouts/Base.astro')).toContain(
      "import '../styles/globals.css'"
    )
  })

  test('globals.css keeps landing brand / hairline / shadcn tokens', () => {
    const css = read('src/styles/globals.css')
    expect(css).toContain('--brand')
    expect(css).toContain('--brand-ink')
    expect(css).toContain('--brand-soft')
    expect(css).toContain('--surface-strong')
    expect(css).toContain('--hairline-soft')
    expect(css).toContain('--hairline-strong')
    expect(css).toContain("@custom-variant dark (&:is([data-theme='dark'] *))")
  })

  test('Nav reuses the landing menu pointed at chmonitor.dev', () => {
    const nav = read('src/components/Nav.astro')
    const base = read('src/layouts/Base.astro')
    expect(nav).toContain("from '../../../landing/src/components/Nav.astro'")
    expect(nav).toContain('origin="https://chmonitor.dev"')
    expect(base).toContain('landing/src/styles/nav.css')
  })

  test('Footer reuses the landing footer pointed at chmonitor.dev', () => {
    const footer = read('src/components/Footer.astro')
    expect(footer).toContain(
      "from '../../../landing/src/components/Footer.astro'"
    )
    expect(footer).toContain('origin="https://chmonitor.dev"')
    expect(read('src/styles/globals.css')).toContain(
      'landing/src/components/Footer.astro'
    )
  })

  test('prose screenshots and img-row break out past the 720px text measure', () => {
    const base = read('src/layouts/Base.astro')
    expect(base).toContain('--maxw-prose:720px')
    expect(base).toContain('--maxw:1080px')
    expect(base).toContain('.prose img{')
    expect(base).toContain('max-width:min(var(--maxw), calc(100vw - 48px))')
    expect(base).toContain('.img-row{')
    expect(base).toContain(
      'grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))'
    )
    expect(base).toContain('.prose .img-row img{')
    expect(base).toContain('transform:none')
    expect(base).toContain('aspect-ratio:16/10')
    expect(base).toContain('object-fit:cover')
    expect(base).toContain('.img-row[data-cols="3"]')
    expect(base).toContain('screenshot-zoom-dialog')
    expect(base).toContain('shot-zoom')
    expect(base).toContain('data-screenshot-zoom')
    expect(base).toContain('width:max-content')
    expect(base).toContain('.shot-frame:hover .shot-zoom')
    expect(base).toContain('background:transparent')
    expect(read('README.md')).toContain('class="img-row"')
    expect(read('README.md')).toContain('small top-right')
  })

  test('featured card is not the old #fff8f1 hardcode', () => {
    const home = read('src/pages/index.astro')
    const base = read('src/layouts/Base.astro')
    expect(home).not.toContain('#fff8f1')
    expect(base).not.toContain('#fff8f1')
    expect(home).toContain('bg-card')
    expect(home).toContain('--brand-soft')
  })
})
