// Pins the deploy-time env projection (modeDefaultVars) against the runtime
// resolver (src/lib/config/deployment-mode.ts resolveConfig/modeDefaults) so
// the two copies of "what a mode means" can never silently drift — see the
// module comment in ./deploy-defaults.ts and #2067 / #2055.

import { resolveConfig } from '../src/lib/config/deployment-mode'
import {
  DEPLOYMENT_MODES,
  modeDefaults,
  modeDefaultVars,
} from './deploy-defaults'
import { describe, expect, test } from 'bun:test'

describe('modeDefaultVars — fail-closed to self-hosted', () => {
  test('oss → no vars emitted', () => {
    // A missing/junk CHM_DEPLOYMENT_MODE must never inject a cloud var into an
    // oss deploy's worker [vars] — the fail-closed invariant this plan pins.
    expect(modeDefaultVars('oss')).toEqual({})
  })

  test('cloud → exactly the five cloud vars', () => {
    expect(modeDefaultVars('cloud')).toEqual({
      CHM_CLOUD_MODE: 'true',
      CHM_AUTH_PROVIDER: 'clerk',
      CHM_CLERK_PUBLIC_READ: 'true',
      CHM_FEATURE_USER_CONNECTIONS_DB: 'true',
      CHM_FEATURE_CONVERSATION_DB: 'true',
    })
  })
})

describe('modeDefaultVars — anti-drift vs the runtime resolver', () => {
  const mock = (vars: Record<string, string>) => (k: string) => vars[k]

  test('projecting a mode to vars and resolving them back yields the same posture', () => {
    // modeDefaultVars() intentionally never emits CHM_DEPLOYMENT_MODE itself
    // (see its docstring), so resolveConfig() falls back to 'oss' for `mode`
    // when fed only the projected vars — every OTHER field must still match
    // modeDefaults(mode) exactly, since each concrete flag is set explicitly.
    for (const mode of DEPLOYMENT_MODES) {
      const vars = modeDefaultVars(mode)
      const { mode: _resolvedMode, ...posture } = resolveConfig(mock(vars))
      expect(posture).toEqual(modeDefaults(mode))
    }
  })
})
