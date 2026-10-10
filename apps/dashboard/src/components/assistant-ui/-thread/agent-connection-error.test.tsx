import type { ReactElement } from 'react'

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

mock.module('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: unknown
    className?: string
  }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}))

const { mapAgentConnectionError } = await import('./agent-connection-error')
const { AgentConnectionErrorNotice } = await import(
  './agent-connection-error-notice'
)

const body = (error: Record<string, unknown>) => JSON.stringify({ error })
const unsupported = (reason: string) =>
  new Error(body({ code: 'USER_CONNECTION_HOST_UNSUPPORTED', reason }))

describe('mapAgentConnectionError', () => {
  test('demo_hidden asks for a connection and links to the add flow', () => {
    const view = mapAgentConnectionError(
      new Error(
        body({ code: 'demo_hidden', reason: 'demo_hidden', message: 'x' })
      )
    )
    expect(view?.title).toBe(
      'Add a ClickHouse connection to use the assistant on your own data'
    )
    expect(view?.action?.to).toBe('/setup')
  })

  test('browser_connection asks to save the connection, with a link', () => {
    const view = mapAgentConnectionError(unsupported('browser_connection'))
    expect(view?.title).toContain('Save this connection to your account')
    expect(view?.action?.to).toBe('/setup')
  })

  test('postgres says the assistant is ClickHouse-only, no action', () => {
    const view = mapAgentConnectionError(unsupported('postgres'))
    expect(view?.title).toBe('The assistant works with ClickHouse connections')
    expect(view?.action).toBeUndefined()
  })

  test('storage_off explains saved connections are off', () => {
    const view = mapAgentConnectionError(unsupported('storage_off'))
    expect(view?.title).toContain('Saved connections are off')
  })

  test('not_signed_in asks to sign in', () => {
    expect(mapAgentConnectionError(unsupported('not_signed_in'))?.kind).toBe(
      'not_signed_in'
    )
  })

  test('CONNECTION_NOT_FOUND says the connection is gone', () => {
    const view = mapAgentConnectionError(
      body({ code: 'CONNECTION_NOT_FOUND', message: 'Connection not found' })
    )
    expect(view?.title).toBe('This connection no longer exists')
    expect(view?.action).toBeDefined()
  })

  test('INVALID_HOST_ID is a generic retry without an action', () => {
    const view = mapAgentConnectionError(
      new Error(body({ code: 'INVALID_HOST_ID' }))
    )
    expect(view?.kind).toBe('invalid_host')
    expect(view?.action).toBeUndefined()
  })

  test('accepts an already-parsed body object', () => {
    expect(
      mapAgentConnectionError({ error: { code: 'CONNECTION_NOT_FOUND' } })?.kind
    ).toBe('not_found')
  })

  test.each([
    ['plain text', new Error('boom')],
    ['unknown code', new Error(body({ code: 'RATE_LIMITED' }))],
    ['unknown reason', unsupported('mystery')],
    ['null', null],
    ['non-JSON string', 'oops'],
  ])('leaves %s to the generic alert', (_name, raw) => {
    expect(mapAgentConnectionError(raw)).toBeNull()
  })
})

describe('AgentConnectionErrorNotice', () => {
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
    await act(async () => {
      createRoot(container).render(node)
    })
    return container
  }

  test('renders the message and an add-connection link', async () => {
    const view = mapAgentConnectionError(
      new Error(body({ code: 'demo_hidden', reason: 'demo_hidden' }))
    )
    if (!view) throw new Error('expected a view')
    const root = await renderInto(<AgentConnectionErrorNotice view={view} />)

    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Add a ClickHouse connection'
    )
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/setup')
    expect(link?.textContent).toBe('Add a connection')
  })

  test('renders no link when the error has no action', async () => {
    const view = mapAgentConnectionError(unsupported('postgres'))
    if (!view) throw new Error('expected a view')
    const root = await renderInto(<AgentConnectionErrorNotice view={view} />)
    expect(root.querySelector('a')).toBeNull()
  })
})
