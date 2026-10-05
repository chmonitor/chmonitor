/**
 * The KPI card's "this card is a link" arrow must be visible to every input mode
 * (#3668).
 *
 * It rested at `opacity-0` behind `group-hover:opacity-100`, and Tailwind v4 wraps
 * a bare `hover:` in `@media (hover: hover)` — so a coarse pointer never saw the
 * arrow at all, on every linked KPI in the overview strip and the query-detail
 * metrics strip. It is an affordance hint, not a control, so it keeps the
 * hover-reveal and rests at `opacity-40` behind `pointer-fine:opacity-0`.
 *
 * `kpi-card.test.tsx` already covers overflow; this file covers reachability.
 *
 * happy-dom loads no stylesheet, so the media-conditioned opacity cannot be read
 * back here. The class contract is asserted on tokens, and the `group` ancestor
 * the reveal hangs off is asserted on the DOM — a `group-hover` whose element is
 * a sibling of the `group` can never fire.
 */

import { Activity } from 'lucide-react'

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

// AppLink is a TanStack Router link; stand in a plain <a> so the card renders
// without a RouterProvider.
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

const { KpiCard } = await import('./kpi-card')

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

function linked(): ReactElement {
  return (
    <KpiCard
      icon={Activity}
      label="Active Queries"
      value="42"
      href="/running-queries?host=0"
    />
  )
}

function arrow(root: HTMLElement): HTMLElement {
  const el = [...root.querySelectorAll('span[aria-hidden]')].find((span) =>
    span.textContent?.includes('→')
  ) as HTMLElement | undefined
  expect(el).toBeDefined()
  return el as HTMLElement
}

describe('KpiCard link arrow', () => {
  test('rests visible on touch and hides only where a hover exists', async () => {
    const root = await renderInto(linked())
    const parts = tokens(arrow(root).className)

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

  // The arrow only renders on the href branch, and the `group` sits on the
  // wrapping <Link> — so the reveal always has an ancestor carrying `group`.
  test('the arrow sits inside the group it reveals off of', async () => {
    const root = await renderInto(linked())
    const link = root.querySelector('a') as HTMLElement

    expect(link).not.toBeNull()
    expect(tokens(link.className)).toContain('group')
    expect(link.contains(arrow(root))).toBe(true)
  })

  // The arrow is a glyph, not a label: the card's own text names it, so the arrow
  // has to stay out of the accessible name.
  test('the arrow is decorative', async () => {
    const root = await renderInto(linked())
    expect(arrow(root).getAttribute('aria-hidden')).toBe('true')
  })

  // No href, no arrow — and no half-applied gate left behind.
  test('an unlinked card renders no arrow', async () => {
    const root = await renderInto(
      <KpiCard icon={Activity} label="Active Queries" value="42" />
    )
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('span[aria-hidden]')).toBeNull()
  })

  test('the card itself is a named, focusable link', async () => {
    const root = await renderInto(linked())
    const link = root.querySelector('a') as HTMLAnchorElement

    expect(link.getAttribute('href')).toBe('/running-queries?host=0')
    // Focus on the link is what makes the arrow's `group-focus-within` reveal
    // fire, so focus has to land on the link rather than a wrapper.
    const { act } = await import('react')
    await act(async () => {
      link.focus()
    })
    expect(document.activeElement).toBe(link)

    // WCAG 2.5.3: the accessible name must contain the visible label.
    const visible = (link.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(visible).toContain('Active Queries')
    expect(link.textContent).toContain('42')
  })
})
