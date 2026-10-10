import { Badge, badgeLabel } from './badge'
import {
  getSelection,
  resetConfigTabsStore,
  resolveSelection,
  STORAGE_PREFIX,
  setSelection,
  subscribe,
} from './config-tabs-store'
import { clampCols, ImageRow } from './image-row'
import { Screenshot } from './screenshot'
import { isDarkDocument, pickThemeSrc } from './theme-src'
import {
  closeZoom,
  openZoom,
  shouldCloseOnClick,
  shouldCloseOnKey,
} from './zoom-controller'
import { beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('light/dark source selection', () => {
  test('dark page with a dark variant uses the dark image', () => {
    expect(pickThemeSrc(true, '/l.webp', '/d.webp')).toBe('/d.webp')
  })
  test('light page always uses the light image', () => {
    expect(pickThemeSrc(false, '/l.webp', '/d.webp')).toBe('/l.webp')
  })
  test('dark page without a dark variant falls back to light (never blank)', () => {
    expect(pickThemeSrc(true, '/l.webp')).toBe('/l.webp')
  })
  test('reads the Fumadocs `dark` class from <html>', () => {
    const doc = (dark: boolean) =>
      ({
        documentElement: { classList: { contains: () => dark } },
      }) as unknown as Document
    expect(isDarkDocument(doc(true))).toBe(true)
    expect(isDarkDocument(doc(false))).toBe(false)
    expect(isDarkDocument(undefined)).toBe(false)
  })
  test('SSR markup ships both images, toggled by the dark variant (no flash)', () => {
    const html = renderToStaticMarkup(
      <Screenshot src="/l.webp" srcDark="/d.webp" alt="Overview" />
    )
    expect(html).toMatch(/src="\/l\.webp"[^>]*class="[^"]*dark:hidden/)
    expect(html).toMatch(/src="\/d\.webp"[^>]*class="[^"]*hidden dark:block/)
  })
  test('without srcDark only one image is rendered in the frame', () => {
    const html = renderToStaticMarkup(<Screenshot src="/l.webp" alt="x" />)
    expect(html).not.toContain('data-theme-src')
  })
  test('wide breaks out to ~1080px; caption renders', () => {
    const html = renderToStaticMarkup(
      <Screenshot src="/a.webp" alt="a" wide caption="Hello" />
    )
    expect(html).toContain('w-[min(1080px,calc(100vw-32px))]')
    expect(html).toContain('<figcaption')
  })
})

describe('zoom dialog', () => {
  function fakeDialog() {
    return {
      open: false,
      calls: [] as string[],
      showModal() {
        this.open = true
        this.calls.push('showModal')
      },
      close() {
        this.open = false
        this.calls.push('close')
      },
    }
  }

  test('open shows the modal once; close closes it', () => {
    const d = fakeDialog()
    openZoom(d)
    openZoom(d) // already open: showModal would throw in browsers
    expect(d.open).toBe(true)
    closeZoom(d)
    closeZoom(d)
    expect(d.open).toBe(false)
    expect(d.calls).toEqual(['showModal', 'close'])
  })
  test('null dialog (not mounted yet) is a no-op', () => {
    expect(() => openZoom(null)).not.toThrow()
    expect(() => closeZoom(null)).not.toThrow()
  })
  test('Esc closes; other keys do not', () => {
    expect(shouldCloseOnKey('Escape')).toBe(true)
    expect(shouldCloseOnKey('Enter')).toBe(false)
  })
  test('backdrop click closes; clicks on the image do not', () => {
    const dialog = {} as EventTarget
    const img = {} as EventTarget
    expect(shouldCloseOnClick(dialog, dialog)).toBe(true)
    expect(shouldCloseOnClick(img, dialog)).toBe(false)
  })
  test('trigger is a labelled button and the dialog has a Close control', () => {
    const html = renderToStaticMarkup(<Screenshot src="/a.webp" alt="Merges" />)
    expect(html).toContain('aria-label="Zoom image: Merges"')
    expect(html).toContain('<dialog')
    expect(html).toContain('aria-label="Close"')
  })
})

describe('ConfigTabs sync + persistence', () => {
  let store: Map<string, string>
  beforeEach(() => {
    resetConfigTabsStore()
    store = new Map()
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage
  })

  test('selecting in one block notifies every block in the group', () => {
    const seen: string[] = []
    subscribe('config', () => seen.push('a'))
    subscribe('config', () => seen.push('b'))
    subscribe('other', () => seen.push('other'))
    setSelection('config', 'Helm')
    expect(seen).toEqual(['a', 'b'])
    expect(getSelection('config')).toBe('Helm')
  })
  test('selection persists to localStorage and is restored', () => {
    setSelection('config', 'Helm')
    expect(store.get(`${STORAGE_PREFIX}config`)).toBe('Helm')
    resetConfigTabsStore()
    expect(getSelection('config')).toBe('Helm')
  })
  test('unsubscribe stops updates', () => {
    let n = 0
    const off = subscribe('config', () => n++)
    off()
    setSelection('config', 'Docker')
    expect(n).toBe(0)
  })
  test('throwing storage does not break selection', () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceeded')
      },
    } as unknown as Storage
    expect(getSelection('config')).toBe(null)
    expect(() => setSelection('config', 'env')).not.toThrow()
    expect(getSelection('config')).toBe('env')
  })
  test('a stored tab this block lacks falls back to the default', () => {
    expect(resolveSelection('Helm', ['Docker', 'Helm'], 'Docker')).toBe('Helm')
    expect(resolveSelection('Helm', ['env', '.env'], 'env')).toBe('env')
    expect(resolveSelection(null, ['Docker'], 'Docker')).toBe('Docker')
  })
})

describe('ImageRow and Badge', () => {
  test('columns clamp to 2-4 and stack to one column on phones', () => {
    expect(clampCols(1)).toBe(2)
    expect(clampCols(9)).toBe(4)
    const html = renderToStaticMarkup(
      <ImageRow
        images={[
          { src: '/a.webp', alt: 'a', caption: 'A' },
          { src: '/b.webp', alt: 'b' },
          { src: '/c.webp', alt: 'c' },
        ]}
      />
    )
    expect(html).toContain('data-cols="3"')
    expect(html).toContain('grid-cols-1')
    expect(html).toContain('md:grid-cols-3')
  })
  test('badge labels per variant', () => {
    expect(badgeLabel('version-added', '0.3')).toBe('Added in v0.3')
    expect(badgeLabel('version-added', 'v0.3')).toBe('Added in v0.3')
    expect(badgeLabel('cloud')).toBe('Cloud')
    expect(badgeLabel('experimental')).toBe('Experimental')
    expect(renderToStaticMarkup(<Badge variant="cloud" />)).toContain(
      'var(--brand,var(--color-fd-primary))'
    )
  })
})
