/**
 * What's new dialog: header/footer stay put; the notes body is the
 * scroll container so a tall list cannot paint under the footer.
 * Initial focus stays on the title so markdown links deep in older
 * notes cannot scrollIntoView the body to the middle on open.
 */

import type { ReactElement } from 'react'
import type { ReleaseNote } from '@/lib/whats-new/types'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import {
  GITHUB_RELEASES_PAGE_URL,
  LANDING_CHANGELOG_URL,
} from '@/lib/whats-new/constants'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as typeof window.matchMedia
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

function tallNote(version: string, bullets: string[]): ReleaseNote {
  return {
    version,
    tag: `v${version}`,
    publishedAt: '2026-08-01T00:00:00Z',
    summary: bullets[0] ?? '',
    markdown: bullets.map((item) => `- ${item}`).join('\n'),
    highlights: bullets,
  }
}

const TALL_RELEASES: ReleaseNote[] = [
  tallNote('0.3.3', [
    'fleet overview',
    'explorer tree',
    'query insights',
    'replication lag',
  ]),
  tallNote('0.3.2', [
    'cluster topology',
    'keeper deep dive',
    'more fleet notes',
    'more explorer notes',
  ]),
  tallNote('0.3.1', [
    'AI agent tools',
    'dashboard charts',
    'settings workspace',
    'last fleet bullet',
    'last explorer bullet',
  ]),
]

describe("What's new dialog layout", () => {
  test('the notes body is the scroll container; footer chrome stays outside it', async () => {
    const { WhatsNewDialog } = await import('./whats-new-dialog')
    const onGotIt = mock(() => {})

    const { cleanup } = await renderInto(
      <WhatsNewDialog
        open
        onOpenChange={() => {}}
        onGotIt={onGotIt}
        releases={TALL_RELEASES}
        isLoading={false}
      />
    )

    try {
      const dialog = document.querySelector('[data-testid="whats-new-dialog"]')
      const body = document.querySelector(
        '[data-testid="whats-new-dialog-body"]'
      )
      const footer = document.querySelector('[data-slot="dialog-footer"]')
      const header = document.querySelector('[data-slot="dialog-header"]')
      const gotIt = document.querySelector('[data-testid="whats-new-got-it"]')
      const versions = [
        ...document.querySelectorAll('[data-testid="whats-new-version"]'),
      ]

      expect(dialog).not.toBeNull()
      expect(body).not.toBeNull()
      expect(footer).not.toBeNull()
      expect(header).not.toBeNull()
      expect(gotIt).not.toBeNull()
      expect(versions.length).toBe(TALL_RELEASES.length)

      const title = document.querySelector('[data-slot="dialog-title"]')
      expect(title).not.toBeNull()
      expect(title?.getAttribute('tabindex')).toBe('-1')
      expect(body?.scrollTop).toBe(0)
      expect(body?.contains(title as Node)).toBe(false)

      expect(dialog?.className).toContain('flex-col')
      expect(dialog?.className).toContain('overflow-hidden')
      expect(body?.className).toContain('min-h-0')
      expect(body?.className).toContain('flex-1')
      expect(body?.className).toContain('overflow-y-auto')
      expect(header?.className).toContain('shrink-0')
      expect(footer?.className).toContain('shrink-0')
      expect(footer?.className.split(/\s+/)).not.toContain('-mx-4')
      expect(footer?.className.split(/\s+/)).not.toContain('-mb-4')

      for (const version of versions) {
        expect(body?.contains(version)).toBe(true)
      }
      expect(body?.contains(gotIt as Node)).toBe(false)
      expect(body?.contains(footer as Node)).toBe(false)
      expect(body?.contains(header as Node)).toBe(false)
      expect(dialog?.contains(body as Node)).toBe(true)
      expect(dialog?.contains(footer as Node)).toBe(true)
      expect(body?.textContent).toContain('last explorer bullet')

      const github = [...document.querySelectorAll('a')].find((anchor) =>
        anchor.textContent?.includes('GitHub Releases')
      )
      const changelog = [...document.querySelectorAll('a')].find((anchor) =>
        anchor.textContent?.includes('Changelog')
      )
      expect(github?.getAttribute('href')).toBe(GITHUB_RELEASES_PAGE_URL)
      expect(changelog?.getAttribute('href')).toBe(LANDING_CHANGELOG_URL)
      expect(body?.contains(github as Node)).toBe(false)
      expect(body?.contains(changelog as Node)).toBe(false)

      expect(
        document.querySelector('[data-testid="whats-new-screenshots"]')
      ).toBeNull()

      const { act } = await import('react')
      await act(async () => {
        ;(gotIt as HTMLButtonElement).click()
      })
      expect(onGotIt).toHaveBeenCalledTimes(1)
    } finally {
      await cleanup()
    }
  })

  test('opens scrolled to the top even when older notes contain deep links', async () => {
    const { WhatsNewDialog } = await import('./whats-new-dialog')
    const deepLinkNote = tallNote('0.2.16', [
      'intro without a link',
      'see [GitHub](https://github.com/chmonitor/chmonitor) for the rest',
      'and another [docs](https://docs.chmonitor.dev) link',
    ])

    const { cleanup } = await renderInto(
      <WhatsNewDialog
        open
        onOpenChange={() => {}}
        onGotIt={() => {}}
        releases={[...TALL_RELEASES, deepLinkNote]}
        isLoading={false}
      />
    )

    try {
      const body = document.querySelector(
        '[data-testid="whats-new-dialog-body"]'
      ) as HTMLDivElement | null
      const title = document.querySelector(
        '[data-slot="dialog-title"]'
      ) as HTMLElement | null
      const deepLink = [...(body?.querySelectorAll('a') ?? [])].find((anchor) =>
        anchor.getAttribute('href')?.includes('github.com/chmonitor')
      )

      expect(body).not.toBeNull()
      expect(title).not.toBeNull()
      expect(deepLink).not.toBeNull()
      expect(body?.scrollTop).toBe(0)
      expect(title?.tabIndex).toBe(-1)
      expect(document.activeElement === deepLink).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test('screenshot thumbs open a full-size overlay inside the dialog', async () => {
    const { WhatsNewDialog } = await import('./whats-new-dialog')
    const withShots: ReleaseNote = {
      ...tallNote('0.3.3', ['guest AI caps']),
      screenshots: [
        {
          src: '/assets/screenshots/overview-dark.png',
          alt: 'Overview',
        },
      ],
    }

    const { cleanup } = await renderInto(
      <WhatsNewDialog
        open
        onOpenChange={() => {}}
        onGotIt={() => {}}
        releases={[withShots]}
        isLoading={false}
      />
    )

    try {
      const thumb = document.querySelector(
        '[data-testid="whats-new-screenshot-thumb"]'
      ) as HTMLButtonElement | null
      expect(thumb).not.toBeNull()
      expect(
        document.querySelector('[data-testid="whats-new-lightbox"]')
      ).toBeNull()

      const { act } = await import('react')
      await act(async () => {
        thumb?.click()
      })

      const lightbox = document.querySelector(
        '[data-testid="whats-new-lightbox"]'
      )
      expect(lightbox).not.toBeNull()
      expect(lightbox?.querySelector('img')?.getAttribute('src')).toBe(
        '/assets/screenshots/overview-dark.png'
      )

      await act(async () => {
        ;(
          document.querySelector(
            '[data-testid="whats-new-lightbox-close"]'
          ) as HTMLButtonElement
        ).click()
      })
      expect(
        document.querySelector('[data-testid="whats-new-lightbox"]')
      ).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
