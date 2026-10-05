/**
 * The health card's "Details" hint must be visible to every input mode (#3668).
 *
 * It rested at `opacity-0` behind `group-hover:opacity-100`, and Tailwind v4 wraps
 * a bare `hover:` in `@media (hover: hover)` — so a coarse pointer got a card that
 * is clickable, focusable and announced as "Open <title> details", with no visible
 * sign that tapping it opens anything. It is a decorative hint (already
 * `aria-hidden`), so it keeps the hover-reveal and rests at `opacity-40` behind
 * `pointer-fine:opacity-0`.
 *
 * happy-dom loads no stylesheet, so the media-conditioned opacity cannot be read
 * back here. The class contract is asserted on tokens, and the `group` ancestor
 * the reveal hangs off is asserted on the DOM.
 */

import type { ReactElement, ReactNode } from 'react'

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

// AppLink is a TanStack Router link; stand in a plain <a>.
mock.module('@/components/ui/app-link', () => ({
  AppLink: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children?: ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { HealthCardShell } = await import('./health-card-shell')

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

async function renderInto(node: ReactElement): Promise<HTMLDivElement> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return container
}

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean)
}

const CARD = {
  title: 'Replication delay',
  status: 'warning' as const,
  displayValue: '84.9%',
  sublabel: 'Replica lag is above 60s',
  hostId: 0,
  onExpand: () => {},
}

function hint(root: HTMLElement): HTMLElement {
  const el = [...root.querySelectorAll('span[aria-hidden]')].find((span) =>
    span.textContent?.includes('Details')
  ) as HTMLElement | undefined
  expect(el).toBeDefined()
  return el as HTMLElement
}

describe('health card details hint', () => {
  test('rests visible on touch and hides only where a hover exists', async () => {
    const root = await renderInto(<HealthCardShell {...CARD} />)
    const parts = tokens(hint(root).className)

    expect(parts).not.toContain('opacity-0')
    // The only opacity-0 allowed is the guarded fine-pointer variant.
    expect(parts.filter((t) => t.endsWith('opacity-0'))).toEqual([
      'pointer-fine:opacity-0',
    ])
    expect(parts).toContain('opacity-40')
    expect(parts).toContain('pointer-fine:group-hover:opacity-40')
    expect(parts).toContain('pointer-fine:group-focus-within:opacity-40')
    // `!` or the reveal ties on specificity with the hold-down and loses on order.
    expect(parts).toContain('group-hover:!opacity-100')
    expect(parts).toContain('group-focus-within:!opacity-100')
  })

  test('the hint sits inside the group it reveals off of', async () => {
    const root = await renderInto(<HealthCardShell {...CARD} />)
    const card = root.firstElementChild as HTMLElement

    expect(tokens(card.className)).toContain('group')
    expect(card.contains(hint(root))).toBe(true)
  })

  test('a card with no onExpand has no hint and no gate', async () => {
    const root = await renderInto(
      <HealthCardShell {...CARD} onExpand={undefined} />
    )
    expect(root.querySelector('span[aria-hidden]')).toBeNull()
  })

  // The whole card is the control, so the hint's reachability is really the
  // card's: focusable, named, and operable with a key.
  test('the card is the focusable, named control that opens details', async () => {
    let opens = 0
    const root = await renderInto(
      <HealthCardShell
        {...CARD}
        onExpand={() => {
          opens += 1
        }}
      />
    )
    const card = root.firstElementChild as HTMLElement

    expect(card.getAttribute('role')).toBe('button')
    expect(card.getAttribute('tabindex')).toBe('0')
    // WCAG 2.5.3: the accessible name has to contain the visible title.
    const name = card.getAttribute('aria-label') ?? ''
    expect(name).toContain(CARD.title)

    const { act } = await import('react')
    await act(async () => {
      card.focus()
    })
    expect(document.activeElement).toBe(card)

    await act(async () => {
      card.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
    })
    expect(opens).toBe(1)
  })
})
