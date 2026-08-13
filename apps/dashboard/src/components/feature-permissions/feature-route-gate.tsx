import { menuItemsConfig } from '@/menu'

import type { ReactNode } from 'react'

import { FeatureUnavailable } from './feature-unavailable'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { findMenuPermissionForPath } from '@/lib/feature-permissions/menu'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'
import { useLocation } from '@tanstack/react-router'

export function FeatureRouteGate({ children }: { children: ReactNode }) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const { config, isLoading } = useFeaturePermissions()
  const permission = findMenuPermissionForPath(menuItemsConfig, pathname)

  if (!permission) return children

  const state = resolveFeatureState(permission, config)
  if (isLoading) {
    return children
  }

  // The frontend renders every enabled feature in every auth mode; access
  // (public vs authenticated) is enforced by the backend, not here — see
  // isFeatureAllowed and lib/feature-permissions/server.ts (the single security
  // boundary). So the only route-level gate is the `enabled` deployment toggle.
  if (!state.enabled) {
    return <FeatureUnavailable feature={permission.feature} reason="disabled" />
  }

  return children
}
