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

mock.module('sonner', () => ({
  toast: { success: mock(() => {}), error: mock(() => {}) },
}))

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

async function renderCard() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return { container, root, act }
}

describe('CustomWebhookTargetCard', () => {
  test('keeps stored URLs masked and renders a shared preview', async () => {
    const { CustomWebhookTargetCard } = await import(
      './custom-webhook-target-card'
    )
    const { container, root, act } = await renderCard()
    const onPreview = mock(async () => ({
      success: true,
      preview: {
        adapterId: 'slack',
        redactedUrl: 'https://hooks.slack.com/••••',
        headers: {},
        body: { text: 'CRITICAL' },
        bodyJson: '{"text":"CRITICAL"}',
        truncated: false,
      },
    }))

    await act(async () => {
      root.render(
        <CustomWebhookTargetCard
          target={{
            id: 'cwt_1234567890abcdef123456',
            name: 'team',
            enabled: true,
            format: 'slack',
            minSeverity: 'warning',
            titleTemplate: '',
            bodyTemplate: '',
            headers: {},
            updatedAt: Date.now(),
            urlConfigured: true,
            urlMasked: 'https://hooks.slack.com/••••',
            source: 'd1',
            editable: true,
          }}
          busy={false}
          onSave={async () => {}}
          onRemove={async () => {}}
          onPreview={onPreview}
        />
      )
    })

    const url = container.querySelector(
      '#custom-webhook-url'
    ) as HTMLInputElement
    expect(url.type).toBe('password')
    expect(url.value).toBe('')
    expect(url.placeholder).toContain('leave blank')

    const previewButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Preview')
    )
    expect(previewButton).toBeDefined()
    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('CRITICAL')
    expect(container.textContent).not.toContain('services/T/B/secret')
  })
})
