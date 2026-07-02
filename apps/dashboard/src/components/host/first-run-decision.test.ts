import type { FirstRunInput } from './first-run-decision'

import { resolveFirstRunAction } from './first-run-decision'
import { describe, expect, it } from 'bun:test'

/**
 * Encodes the cloud-mode host-resolution invariant (docs/knowledge/cloud-saas-mode.md):
 * a signed-in user must NEVER be served the read-only demo host. The demo is
 * hidden from their merged host list, so a stale `?host=0` (carried over from
 * browsing the demo while anonymous) resolves to no visible host — and must not
 * fall through to rendering demo-backed charts.
 */

// Sensible defaults; each test overrides only what it exercises.
function input(overrides: Partial<FirstRunInput> = {}): FirstRunInput {
  return {
    isLoading: false,
    isUnauthorized: false,
    onExemptPath: false,
    hostCount: 1,
    cloudMode: false,
    isSignedIn: false,
    hasVisibleResolvedHost: true,
    firstVisibleHostId: 0,
    ...overrides,
  }
}

describe('resolveFirstRunAction — cloud + signed-in (the bug)', () => {
  it('signed-in cloud user with ZERO connections and stale ?host=0 → setup, not demo data', () => {
    // Demo hidden ⇒ hostCount 0, and the stale ?host=0 resolves to nothing.
    const action = resolveFirstRunAction(
      input({
        cloudMode: true,
        isSignedIn: true,
        hostCount: 0,
        hasVisibleResolvedHost: false,
        firstVisibleHostId: null,
      })
    )
    expect(action).toEqual({ type: 'setup' })
  })

  it('does NOT render (leak demo) while their own connections are still loading', () => {
    // The regression: previously the gate rendered children during this window,
    // so demo charts mounted and fetched ?host=0. Must wait instead.
    const action = resolveFirstRunAction(
      input({
        cloudMode: true,
        isSignedIn: true,
        isLoading: true,
        hostCount: 0,
        hasVisibleResolvedHost: false,
        firstVisibleHostId: null,
      })
    )
    expect(action).toEqual({ type: 'wait' })
  })

  it('signed-in cloud user WITH own host but stale ?host=0 → re-point to their host', () => {
    const action = resolveFirstRunAction(
      input({
        cloudMode: true,
        isSignedIn: true,
        hostCount: 1,
        hasVisibleResolvedHost: false, // ?host=0 is the hidden demo, not theirs
        firstVisibleHostId: -1000, // db connections use negative ids
      })
    )
    expect(action).toEqual({ type: 'repoint', hostId: -1000 })
  })

  it('signed-in cloud user on their OWN host (?host=-1000) → render', () => {
    const action = resolveFirstRunAction(
      input({
        cloudMode: true,
        isSignedIn: true,
        hostCount: 1,
        hasVisibleResolvedHost: true,
        firstVisibleHostId: -1000,
      })
    )
    expect(action).toEqual({ type: 'render' })
  })
})

describe('resolveFirstRunAction — anonymous cloud (demo is intended)', () => {
  it('anonymous cloud visitor sees the demo → render', () => {
    const action = resolveFirstRunAction(
      input({
        cloudMode: true,
        isSignedIn: false,
        hostCount: 1,
        hasVisibleResolvedHost: true, // demo is visible to anon
        firstVisibleHostId: 0,
      })
    )
    expect(action).toEqual({ type: 'render' })
  })
})

describe('resolveFirstRunAction — self-hosted (OSS) unchanged', () => {
  it('OSS with configured env hosts → render', () => {
    expect(resolveFirstRunAction(input())).toEqual({ type: 'render' })
  })

  it('OSS with zero hosts once resolved → setup', () => {
    const action = resolveFirstRunAction(
      input({ hostCount: 0, hasVisibleResolvedHost: false })
    )
    expect(action).toEqual({ type: 'setup' })
  })

  it('OSS while hosts are still loading → render children (skeletons/Suspense)', () => {
    const action = resolveFirstRunAction(
      input({ isLoading: true, hostCount: 0, hasVisibleResolvedHost: false })
    )
    expect(action).toEqual({ type: 'render' })
  })
})

describe('resolveFirstRunAction — exemptions & auth', () => {
  it('exempt paths (/setup, /billing, /organization) always render', () => {
    const action = resolveFirstRunAction(
      input({
        onExemptPath: true,
        cloudMode: true,
        isSignedIn: true,
        hostCount: 0,
        hasVisibleResolvedHost: false,
        firstVisibleHostId: null,
      })
    )
    expect(action).toEqual({ type: 'render' })
  })

  it('a 401/403 host fetch does not wall the app (renders, not setup)', () => {
    const action = resolveFirstRunAction(
      input({
        isUnauthorized: true,
        hostCount: 0,
        hasVisibleResolvedHost: false,
      })
    )
    expect(action).toEqual({ type: 'render' })
  })
})
