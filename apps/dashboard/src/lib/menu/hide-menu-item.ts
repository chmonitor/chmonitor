import { toast } from 'sonner'
import { menuItemsConfig } from '@/menu'

import type { UserSettings } from '@/lib/types/user-settings'

import {
  hideMenuHref,
  showMenuHref,
  workspaceFromSettings,
} from '@/lib/menu/workspace-presets'

export const FIRST_HIDE_TOAST_MS = 8_000
export const HIDE_TOAST_MS = 4_000

let isFirstHideToast = true

export function resetHideMenuToastState(): void {
  isFirstHideToast = true
}

export function consumeHideToastDuration(): number {
  if (isFirstHideToast) {
    isFirstHideToast = false
    return FIRST_HIDE_TOAST_MS
  }
  return HIDE_TOAST_MS
}

export function persistHideMenuHref(
  settings: UserSettings,
  href: string
): Pick<UserSettings, 'workspacePreset' | 'hiddenMenuHrefs'> {
  const next = hideMenuHref(
    menuItemsConfig,
    workspaceFromSettings(settings),
    href
  )
  return {
    workspacePreset: next.workspacePreset,
    hiddenMenuHrefs: [...next.hiddenMenuHrefs],
  }
}

export function persistShowMenuHref(
  settings: UserSettings,
  href: string
): Pick<UserSettings, 'workspacePreset' | 'hiddenMenuHrefs'> {
  const next = showMenuHref(
    menuItemsConfig,
    workspaceFromSettings(settings),
    href
  )
  return {
    workspacePreset: next.workspacePreset,
    hiddenMenuHrefs: [...next.hiddenMenuHrefs],
  }
}

export function showHiddenMenuToast(options: {
  title: string
  onUndo: () => void
  onOpenNavigation: () => void
}): void {
  toast(`${options.title} hidden from the menu`, {
    description: 'Bring it back in Settings → Workspace → Navigation.',
    duration: consumeHideToastDuration(),
    action: {
      label: 'Undo',
      onClick: options.onUndo,
    },
    cancel: {
      label: 'Open Navigation',
      onClick: options.onOpenNavigation,
    },
  })
}
