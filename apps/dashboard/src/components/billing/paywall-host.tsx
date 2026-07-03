/**
 * Renders the global `PaywallModal` once, driven by the paywall store
 * (`lib/billing/paywall-store.ts`). Mounted in `DashboardShell` next to
 * `<Toaster />` — same "singleton host at the shell" pattern.
 */
import { useSyncExternalStore } from 'react'

import {
  getPaywallServerSnapshot,
  getPaywallSnapshot,
  hidePaywall,
  subscribePaywall,
} from '@/lib/billing/paywall-store'
import { PaywallModal } from './paywall-modal'

export function usePaywall() {
  return useSyncExternalStore(
    subscribePaywall,
    getPaywallSnapshot,
    getPaywallServerSnapshot
  )
}

export function PaywallHost() {
  const state = usePaywall()
  // `reason` stays populated after close (see paywall-store.ts hidePaywall) so
  // the dialog's close animation doesn't flash empty content — this null
  // check only skips the very first render, before any 402 has fired.
  if (!state.reason) return null

  return (
    <PaywallModal
      open={state.open}
      reason={state.reason}
      message={state.message}
      currentPlanId={state.planId}
      onClose={hidePaywall}
    />
  )
}
