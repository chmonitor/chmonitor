/**
 * The copy control on an expanded running query and an expanded expensive query
 * must stay visible on a coarse pointer (#3645). Touch has no hover, so a bare
 * `opacity-0` revealed only by `group-hover` can never be seen or tapped.
 *
 * The contract is the one `cards/chart-action-classes.ts` already ships: rest at
 * `opacity-40`, hide only under `pointer-fine:opacity-0`, reveal on
 * `pointer-fine:group-hover` / `pointer-fine:group-focus-within`.
 *
 * Both rows are rendered from their real start state (via `derive`, the same
 * entry point the tables use) and the shipped `CodeBlockCopyButton` is read back
 * out of the DOM. happy-dom loads no stylesheet, so a media-query-conditioned
 * opacity cannot be observed — the resting/reveal pair is asserted on class
 * tokens, which is the same contract `chart-collapse-touch.test.tsx` locks in.
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

// ExpandedRow reads ?host= through the router and renders AppLink (a router
// Link). Neither exists outside a router context; both are irrelevant here.
mock.module('@/lib/swr/use-host', () => ({ useHostId: () => 0 }))
mock.module('@/components/ui/app-link', () => ({
  AppLink: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const { ExpandedRow: RunningExpandedRow } = await import('./expanded-row')
const { derive: deriveRunning } = await import('./types')
const { ExpandedRow: ExpensiveExpandedRow } = await import(
  '../../expensive-queries/table/expanded-row'
)
const { derive: deriveExpensive } = await import(
  '../../expensive-queries/table/types'
)

const SQL = 'SELECT 1'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }

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

/** `pointer-fine:opacity-0` contains the letters opacity-0 but is not a bare token. */
function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean)
}

async function renderRunningRow(): Promise<HTMLDivElement> {
  return renderInto(
    <RunningExpandedRow
      d={deriveRunning({
        query_id: 'q1',
        query: SQL,
        user: 'default',
        current_database: 'system',
        elapsed: 1,
      })}
      onKill={() => {}}
      isKilling={false}
    />
  )
}

async function renderExpensiveRow(): Promise<HTMLDivElement> {
  return renderInto(
    <ExpensiveExpandedRow
      d={deriveExpensive({ normalized_query_hash: 'h1', query: SQL }, 0)}
    />
  )
}

function copyControlClass(root: HTMLDivElement): string {
  const copy = root.querySelector('[aria-label="Copy code"]')
  expect(copy).not.toBeNull()
  const parts = tokens(copy?.getAttribute('class') ?? '')

  // A bare `opacity-0` is the bug: it hides the control from every pointer, and
  // only the hover/focus pair brings it back. `pointer-fine:opacity-0` is a
  // different token and must not satisfy this.
  expect(parts).not.toContain('opacity-0')
  expect(parts).toContain('opacity-40')
  expect(parts).toContain('pointer-fine:opacity-0')
  expect(parts).toContain('pointer-fine:group-hover:opacity-100')
  expect(parts).toContain('pointer-fine:group-focus-within:opacity-100')

  return copy?.getAttribute('class') ?? ''
}

describe('expanded query copy controls on touch', () => {
  test('running-query row rests visible instead of waiting for a hover', async () => {
    copyControlClass(await renderRunningRow())
  })

  test('expensive-query row rests visible instead of waiting for a hover', async () => {
    copyControlClass(await renderExpensiveRow())
  })
})
