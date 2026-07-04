/**
 * Paywall store — a tiny external store that lets `apiFetch` (a plain
 * function, outside the React tree) trigger the global PaywallModal from
 * anywhere a 402 billing-limit response is read.
 *
 * Same shape as other global singletons in this codebase (e.g. sonner's
 * `toast()`): a module-level snapshot + listener set, read reactively via
 * `useSyncExternalStore` in `usePaywall()` (components/billing/paywall-host.tsx).
 *
 * Fail-open by construction: this store only ever changes state when
 * `showPaywall()` is called, which only happens when `apiFetch` classifies a
 * real 402 billing-limit body (`classifyBillingLimit`). No 402 without Clerk
 * (see `lib/billing/entitlements.ts`) means this never fires on OSS/self-host.
 */
import type { BillingLimitClassification } from '@/lib/api/error-handler/types'

export interface PaywallState {
  open: boolean
  reason: BillingLimitClassification['reason'] | null
  message: string
  planId: string
}

const INITIAL_STATE: PaywallState = {
  open: false,
  reason: null,
  message: '',
  planId: 'free',
}

let state: PaywallState = INITIAL_STATE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Opens the modal for a classified billing-limit hit. */
export function showPaywall(classification: BillingLimitClassification): void {
  state = { open: true, ...classification }
  emit()
}

/** Closes the modal. The last reason/message/planId are kept (not reset) so
 * the close animation doesn't flash empty content. */
export function hidePaywall(): void {
  if (!state.open) return
  state = { ...state, open: false }
  emit()
}

export function subscribePaywall(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPaywallSnapshot(): PaywallState {
  return state
}

/** SSR/prerender snapshot — always closed; the store never mutates server-side. */
export function getPaywallServerSnapshot(): PaywallState {
  return INITIAL_STATE
}
