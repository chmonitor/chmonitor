/**
 * Client dispatch-path tests for per-channel gating (#2661).
 *
 * Proves `dispatchAlert` honours BOTH new knobs — a disabled channel and a
 * raised per-channel `minSeverity` — through the shared
 * {@link resolveChannelDelivery} (matrix-tested in
 * `alert-channel-settings.test.ts`). We assert on the outbound `fetch` calls the
 * webhook / healthchecks channels make; the in-app + browser channels are left
 * out of scope here (browser notifications need a granted `Notification`
 * permission the test runner has no way to grant).
 *
 * Both the webhook and the healthchecks pings POST to `/api/v1/health/webhook`,
 * so we distinguish them by body: a healthchecks ping carries
 * `provider: 'raw-get'`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { dispatchAlert } from '@/lib/health/alert-dispatcher'
import {
  type AlertSettings,
  saveAlertSettings,
} from '@/lib/health/alert-settings-storage'

interface Captured {
  url: string
  body: Record<string, unknown>
}

function makeLocalStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

let captured: Captured[] = []
let realFetch: typeof fetch

beforeEach(() => {
  const ls = makeLocalStorage()
  globalThis.window = {
    localStorage: ls,
    dispatchEvent: () => true,
    // Event's own constructor already accepts (type, init) — no override needed.
    CustomEvent: class CustomEvent extends Event {},
  } as unknown as Window & typeof globalThis
  Object.defineProperty(globalThis, 'localStorage', {
    value: ls,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: globalThis.window.CustomEvent,
    configurable: true,
    writable: true,
  })

  captured = []
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    })
    return { ok: true } as Response
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  // @ts-expect-error — restore
  delete globalThis.window
})

const BASE: AlertSettings = {
  webhookUrl: 'https://hooks.slack.com/services/x',
  webhookEnabled: true,
  healthchecksUrl: 'https://hc-ping.com/abc',
  browserNotificationsEnabled: false,
  minSeverity: 'warning',
}

const webhookCalls = () =>
  captured.filter(
    (c) => c.url.includes('/health/webhook') && c.body.provider !== 'raw-get'
  )
const healthchecksCalls = () =>
  captured.filter((c) => c.body.provider === 'raw-get')

describe('dispatchAlert — per-channel gating', () => {
  test('both channels fire when nothing is overridden', async () => {
    saveAlertSettings(BASE)
    await dispatchAlert({
      checkId: 'c',
      title: 'T',
      severity: 'warning',
      value: 1,
      label: 'x',
      hostId: 0,
    })
    expect(webhookCalls()).toHaveLength(1)
    expect(healthchecksCalls()).toHaveLength(1)
  })

  test('a disabled channel never fires; siblings still do', async () => {
    saveAlertSettings({ ...BASE, channels: { webhook: { enabled: false } } })
    await dispatchAlert({
      checkId: 'c',
      title: 'T',
      severity: 'critical',
      value: 1,
      label: 'x',
      hostId: 0,
    })
    expect(webhookCalls()).toHaveLength(0)
    expect(healthchecksCalls()).toHaveLength(1)
  })

  test('a per-channel critical floor drops a warning on that channel only', async () => {
    saveAlertSettings({
      ...BASE,
      minSeverity: 'warning',
      channels: { healthchecks: { minSeverity: 'critical' } },
    })
    await dispatchAlert({
      checkId: 'c',
      title: 'T',
      severity: 'warning',
      value: 1,
      label: 'x',
      hostId: 0,
    })
    // webhook inherits the warning global gate and fires; healthchecks is
    // raised to critical-only and stays silent for this warning.
    expect(webhookCalls()).toHaveLength(1)
    expect(healthchecksCalls()).toHaveLength(0)
  })

  test('a per-channel warning floor beats a critical global gate', async () => {
    saveAlertSettings({
      ...BASE,
      minSeverity: 'critical',
      channels: { webhook: { minSeverity: 'warning' } },
    })
    await dispatchAlert({
      checkId: 'c',
      title: 'T',
      severity: 'warning',
      value: 1,
      label: 'x',
      hostId: 0,
    })
    // Global is critical-only, but the webhook channel opts back down to
    // warning; healthchecks inherits the critical gate and stays silent.
    expect(webhookCalls()).toHaveLength(1)
    expect(healthchecksCalls()).toHaveLength(0)
  })
})
