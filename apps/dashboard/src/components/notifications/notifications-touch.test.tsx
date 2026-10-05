/**
 * The notification row's external-link cue must be visible to every input mode
 * (#3668).
 *
 * It rested at `opacity-0` behind `group-hover:opacity-100`, and Tailwind v4 wraps
 * a bare `hover:` in `@media (hover: hover)` — so a coarse pointer never saw the
 * "this row leaves the page" cue at all. It is an affordance hint rather than a
 * control, so it keeps the hover-reveal and rests at `opacity-40` behind
 * `pointer-fine:opacity-0`. It is also decorative: the row's own `aria-label`
 * supplies the accessible name, so the icon is `aria-hidden`.
 *
 * happy-dom loads no stylesheet, so the media-conditioned opacity cannot be read
 * back here. The class contract is asserted on tokens; reachability and the name
 * are asserted as DOM behaviour.
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

mock.module('@/lib/swr/use-host', () => ({ useHostId: () => 0 }))
mock.module('@/lib/swr/use-notifications', () => ({
  useNotifications: () => ({
    notifications: [
      {
        key: 'readonly-tables:prod',
        type: 'readonly-tables',
        cluster: 'prod',
        count: 3,
        severity: 'critical',
      },
    ],
    totalCount: 3,
    isLoading: false,
    error: undefined,
    refresh: () => {},
    dismissAll: () => {},
  }),
}))

// No test in this repo drives a Base UI overlay open under happy-dom, and the
// row under test lives inside PopoverContent. Pass the overlay through so the row
// renders; the popover itself is not what this file is about.
mock.module('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children?: ReactNode }) => (
    <div data-slot="popover-content">{children}</div>
  ),
  PopoverTrigger: () => <span />,
}))

// AppLink is a TanStack Router link; stand in a plain <a> so the row renders
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

const { NotificationsPopover } = await import('./notifications-popover')

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
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

describe('notification row link cue', () => {
  test('rests visible on touch and hides only where a hover exists', async () => {
    const root = await renderInto(<NotificationsPopover />)
    const row = root.querySelector('a') as HTMLElement
    const icon = row.querySelector('svg.lucide-external-link')
    expect(icon).not.toBeNull()

    const parts = tokens((icon as SVGElement).getAttribute('class') ?? '')
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

  // The reveal has to hang off an ancestor that actually carries `group`.
  test('the cue sits inside the group it reveals off of', async () => {
    const root = await renderInto(<NotificationsPopover />)
    const row0 = root.querySelector('a') as HTMLElement
    expect(row0).not.toBeNull()
    expect(tokens(row0.className)).toContain('group')

    const icon = root.querySelector('svg.lucide-external-link')
    expect(row0.contains(icon as Node)).toBe(true)
  })

  // The icon is a hint, not the label: the row's aria-label names it, so the icon
  // must stay out of the accessible name.
  test('the cue is decorative and the row keeps its own name', async () => {
    const root = await renderInto(<NotificationsPopover />)
    const row = root.querySelector('a') as HTMLAnchorElement
    const icon = row.querySelector('svg.lucide-external-link')

    expect(icon).not.toBeNull()
    expect(row.getAttribute('aria-label')).toBe(
      'Readonly Tables in cluster prod'
    )
    // Nothing the icon contributes reaches the name.
    expect(row.getAttribute('aria-label')).not.toContain('svg')
  })

  test('the row is a named link with an href and a real focus target', async () => {
    const root = await renderInto(<NotificationsPopover />)
    const row = root.querySelector('a') as HTMLAnchorElement

    expect(row.tagName).toBe('A')
    expect(row.getAttribute('href')).toBe('/readonly-tables?host=0')
    expect(row.getAttribute('aria-label')).toBeTruthy()

    const { act } = await import('react')
    await act(async () => {
      row.focus()
    })
    expect(document.activeElement).toBe(row)
  })
})
