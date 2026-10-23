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

const createSubscription = mock(async (_input: unknown) => ({ secret: 's' }))
const updateSubscription = mock(async (_id: string, _patch: unknown) => ({}))

const sub = {
  id: 'whs_1',
  url: 'https://example.com/hook',
  eventTypes: ['alert.fired'],
  enabled: true,
  scope: 'instance' as const,
  details: false,
  createdAt: 0,
  updatedAt: 0,
}

let realSonner: object
let realHooks: object

beforeAll(async () => {
  GlobalRegistrator.register()
  realSonner = { ...(await import('sonner')) }
  realHooks = { ...(await import('@/lib/hooks/use-webhook-subscriptions')) }
  mock.module('sonner', () => ({
    toast: { success: mock(() => {}), error: mock(() => {}) },
  }))
  mock.module('@/lib/hooks/use-webhook-subscriptions', () => ({
    useWebhookSubscriptions: () => ({
      subscriptions: [sub],
      isLoading: false,
      featureEnabled: true,
      isSignedIn: true,
      refetch: () => {},
    }),
    useWebhookDeliveries: () => ({ deliveries: [], isLoading: false }),
    useWebhookSubscriptionsMutations: () => ({
      createSubscription,
      updateSubscription,
      deleteSubscription: async () => {},
      sendTestPing: async () => ({ status: 'delivered' }),
    }),
  }))

  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('sonner', () => realSonner)
  mock.module('@/lib/hooks/use-webhook-subscriptions', () => realHooks)
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
  createSubscription.mockClear()
  updateSubscription.mockClear()
})

async function renderPanel() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WebhookSubscriptionsPanel } = await import(
    './webhook-subscriptions-panel'
  )
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WebhookSubscriptionsPanel />)
  })
  return { container, act }
}

const click = (el: Element | null | undefined) =>
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('WebhookSubscriptionsPanel alert details toggle', () => {
  test('the create form describes the flag and sends details: false by default', async () => {
    const { container, act } = await renderPanel()
    expect(container.textContent).toContain(
      'Include the structured alert block for agents'
    )
    const input = container.querySelector(
      'input[placeholder^="https://"]'
    ) as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setValue?.call(input, 'https://example.com/new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      click(container.querySelector('#event-type-alert\\.fired'))
    })
    const add = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add'
    )
    await act(async () => {
      click(add)
    })
    expect(createSubscription).toHaveBeenCalledTimes(1)
    expect(createSubscription.mock.calls[0]?.[0]).toMatchObject({
      details: false,
    })
  })

  test('checking the create toggle sends details: true', async () => {
    const { container, act } = await renderPanel()
    const input = container.querySelector(
      'input[placeholder^="https://"]'
    ) as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setValue?.call(input, 'https://example.com/new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      click(container.querySelector('#event-type-alert\\.fired'))
    })
    await act(async () => {
      click(container.querySelector('#subscription-details'))
    })
    const add = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add'
    )
    await act(async () => {
      click(add)
    })
    expect(createSubscription.mock.calls[0]?.[0]).toMatchObject({
      details: true,
    })
  })

  test('an existing subscription can switch details on', async () => {
    const { container, act } = await renderPanel()
    await act(async () => {
      click(container.querySelector(`#details-${sub.id}`))
    })
    expect(updateSubscription).toHaveBeenCalledWith(sub.id, { details: true })
  })
})
