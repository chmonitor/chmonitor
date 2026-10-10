/**
 * #3438 (PR 3/3) — the seven former Advanced sections, regrouped.
 *
 * Pins that each of the seven is still reachable as a launcher card in exactly
 * one group, and that a deep link only opens a dialog in the group that owns
 * it (the same resolved section is handed to every group on a tab).
 * The panels themselves are stubbed: this is about reachability, and each
 * panel keeps its own capability tests.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const stub = (name: string) => () => <div data-testid={`panel-${name}`} />
mock.module('./alert-routing-dialog', () => ({
  AlertRoutingPanel: stub('routing'),
}))
mock.module('./alert-suggestions-panel', () => ({
  AlertSuggestionsPanel: stub('suggested'),
}))
mock.module('./digest-settings-panel', () => ({
  DigestSettingsPanel: stub('digest'),
}))
mock.module('./maintenance-windows-panel', () => ({
  MaintenanceWindowsPanel: stub('maintenance'),
}))
mock.module('./peerdb-rules-panel', () => ({
  PeerDBRulesPanel: stub('peerdb-rules'),
}))
mock.module('./quiet-hours-panel', () => ({
  QuietHoursPanel: stub('quiet-hours'),
}))
mock.module('./rule-builder', () => ({
  RuleBuilderPanel: stub('custom-rules'),
}))
mock.module('./webhook-subscriptions-panel', () => ({
  WebhookSubscriptionsPanel: stub('webhooks'),
}))

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const TITLES: Record<string, string[]> = {
  define: ['Suggested alerts', 'Custom rules', 'PeerDB mirror rules'],
  delivery: ['Routing rules', 'Webhook subscriptions', 'Digest'],
  silencing: ['Quiet hours', 'Maintenance windows'],
}

async function mount(element: unknown) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(element as never))
  return {
    buttons: () =>
      Array.from(container.querySelectorAll('button')).map(
        (b) => b.textContent ?? ''
      ),
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

describe('AlertSectionGroup', () => {
  test('all eight sections are reachable, each in one group', async () => {
    const { AlertSectionGroup } = await import('./advanced-settings-panel')
    const seen: string[] = []
    for (const [group, titles] of Object.entries(TITLES)) {
      const view = await mount(<AlertSectionGroup group={group as never} />)
      const buttons = view.buttons()
      for (const title of titles) {
        expect(buttons.some((t) => t.startsWith(title))).toBe(true)
      }
      expect(buttons).toHaveLength(titles.length)
      seen.push(...titles)
      await view.unmount()
    }
    expect(new Set(seen).size).toBe(8)
  })

  test('a deep link opens its dialog only in the owning group', async () => {
    const { AlertSectionGroup } = await import('./advanced-settings-panel')
    const panel = () => document.querySelector('[data-testid="panel-routing"]')
    const other = await mount(
      <AlertSectionGroup group="define" initialSection="routing" />
    )
    expect(panel()).toBeNull()
    await other.unmount()
    const owner = await mount(
      <AlertSectionGroup group="delivery" initialSection="routing" />
    )
    expect(panel()).not.toBeNull()
    await owner.unmount()
  })

  test('the Advanced tab now holds only the silencing group', async () => {
    const { AdvancedSettingsPanel } = await import('./advanced-settings-panel')
    const view = await mount(<AdvancedSettingsPanel />)
    expect(view.buttons()).toHaveLength(2)
    await view.unmount()
  })
})
