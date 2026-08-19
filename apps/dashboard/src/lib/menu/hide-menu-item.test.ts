import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  DEFAULT_USER_SETTINGS,
  type UserSettings,
} from '@/lib/types/user-settings'

const toastMock = mock((_title: string, _opts?: unknown) => ({ id: 'toast' }))

mock.module('sonner', () => ({
  toast: toastMock,
}))

const {
  consumeHideToastDuration,
  FIRST_HIDE_TOAST_MS,
  HIDE_TOAST_MS,
  persistHideMenuHref,
  persistShowMenuHref,
  resetHideMenuToastState,
  showHiddenMenuToast,
} = await import('./hide-menu-item')

afterEach(() => {
  resetHideMenuToastState()
  toastMock.mockClear()
})

describe('persistHideMenuHref / persistShowMenuHref', () => {
  test('hiding a leaf switches to Custom and records the href', () => {
    const next = persistHideMenuHref(DEFAULT_USER_SETTINGS, '/overview')
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).toContain('/overview')
  })

  test('showing a hidden leaf drops that href', () => {
    const hidden: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/overview', '/queries'],
    }
    const next = persistShowMenuHref(hidden, '/overview')
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).not.toContain('/overview')
    expect(next.hiddenMenuHrefs).toContain('/queries')
  })
})

describe('hide-page toast', () => {
  test('first hide uses a longer duration; later hides use the default', () => {
    expect(consumeHideToastDuration()).toBe(FIRST_HIDE_TOAST_MS)
    expect(consumeHideToastDuration()).toBe(HIDE_TOAST_MS)
    expect(consumeHideToastDuration()).toBe(HIDE_TOAST_MS)
  })

  test('copy includes Undo and Open Navigation actions', () => {
    const onUndo = mock(() => {})
    const onOpenNavigation = mock(() => {})
    showHiddenMenuToast({
      title: 'Overview',
      onUndo,
      onOpenNavigation,
    })
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [title, opts] = toastMock.mock.calls[0] as [
      string,
      {
        description: string
        duration: number
        action: { label: string; onClick: () => void }
        cancel: { label: string; onClick: () => void }
      },
    ]
    expect(title).toBe('Overview hidden from the menu')
    expect(opts.description).toBe(
      'Bring it back in Settings → Workspace → Navigation.'
    )
    expect(opts.duration).toBe(FIRST_HIDE_TOAST_MS)
    expect(opts.action.label).toBe('Undo')
    expect(opts.cancel.label).toBe('Open Navigation')
    opts.action.onClick()
    opts.cancel.onClick()
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onOpenNavigation).toHaveBeenCalledTimes(1)
  })
})
