/**
 * The integration-tools gate decides whether the model is told the read-only
 * PeerDB / Postgres tools exist (#3674). Every row of the issue's decision
 * table is pinned here: a wrong row either hides tools an operator opted into,
 * or hands an anonymous cloud visitor reads of the operator's PeerDB/Postgres.
 */

import type {
  IntegrationGateInput,
  Reachability,
} from '../integration-tools-gate'

import {
  formatIntegrationReason,
  INTEGRATION_PIN_PART_TYPE,
  readIntegrationPin,
  resolveIntegrationPolicy,
  resolveIntegrationToolsEnabled,
} from '../integration-tools-gate'
import { describe, expect, test } from 'bun:test'

const UP: Reachability = { ok: true }
const DOWN: Reachability = { ok: false, kind: 'refused' }
const SLOW: Reachability = { ok: false, kind: 'probe_timeout' }

const base: IntegrationGateInput = {
  flag: undefined,
  configured: true,
  cloud: false,
  signedIn: true,
  reachability: UP,
}

type Row = [string, Partial<IntegrationGateInput>, boolean, string]

const ROWS: Row[] = [
  // flag false = kill switch, whatever else holds
  ['flag false, reachable', { flag: 'false' }, false, 'flag_false'],
  ['flag 0 (parseBool grammar)', { flag: '0' }, false, 'flag_false'],
  [
    'flag false, unconfigured',
    { flag: 'false', configured: false },
    false,
    'flag_false',
  ],
  [
    'kill switch beats flag true',
    { flag: 'true', killSwitch: true },
    false,
    'kill_switch',
  ],
  ['kill switch beats auto', { killSwitch: true }, false, 'kill_switch'],
  // not configured → off
  [
    'unconfigured, flag true',
    { flag: 'true', configured: false },
    false,
    'unconfigured',
  ],
  ['unconfigured, flag unset', { configured: false }, false, 'unconfigured'],
  // flag true → on when configured, reachability ignored
  ['flag true, reachable', { flag: 'true' }, true, 'flag_true'],
  [
    'flag true, unreachable',
    { flag: 'true', reachability: DOWN },
    true,
    'flag_true',
  ],
  [
    'flag yes, not probed',
    { flag: 'yes', reachability: undefined },
    true,
    'flag_true',
  ],
  // flag unset → reachability decides
  ['unset, reachable', {}, true, 'auto'],
  ['unset, unreachable', { reachability: DOWN }, false, 'unreachable'],
  ['unset, probe timeout', { reachability: SLOW }, false, 'probe_timeout'],
  ['unset, unknown', { reachability: undefined }, false, 'unknown'],
  ['junk flag behaves as unset', { flag: 'maybe' }, true, 'auto'],
  // cloud anonymous → always off
  [
    'cloud anon, flag true',
    { cloud: true, signedIn: false, flag: 'true' },
    false,
    'cloud_anon',
  ],
  ['cloud anon, auto', { cloud: true, signedIn: false }, false, 'cloud_anon'],
  // cloud signed-in: deployment-env sources need an explicit opt-in
  ['cloud signed-in, unset, reachable', { cloud: true }, false, 'needs_opt_in'],
  [
    'cloud signed-in, flag true',
    { cloud: true, flag: 'true' },
    true,
    'flag_true',
  ],
  // own connection: same rule (the env source is the operator's)
  ['own connection, unset', { ownConnection: true }, false, 'needs_opt_in'],
  [
    'own connection, flag true',
    { ownConnection: true, flag: 'true' },
    true,
    'flag_true',
  ],
  // self-hosted anonymous Clerk visitor follows the flag like public-read
  ['self-hosted anon, auto', { signedIn: false }, true, 'auto'],
]

describe('resolveIntegrationToolsEnabled — decision table', () => {
  for (const [name, overrides, enabled, reason] of ROWS) {
    test(name, () => {
      const d = resolveIntegrationToolsEnabled({ ...base, ...overrides })
      expect(d.enabled).toBe(enabled)
      expect(d.reason).toBe(reason as never)
    })
  }

  test('policy is null only when reachability decides', () => {
    expect(resolveIntegrationPolicy({ ...base })).toBeNull()
    expect(resolveIntegrationPolicy({ ...base, flag: 'true' })).not.toBeNull()
    expect(
      resolveIntegrationPolicy({ ...base, cloud: true, signedIn: false })
    ).not.toBeNull()
  })

  test('reason label carries the failure kind, nothing else', () => {
    const d = resolveIntegrationToolsEnabled({ ...base, reachability: DOWN })
    expect(formatIntegrationReason(d)).toBe('unreachable:refused')
  })
})

describe('readIntegrationPin', () => {
  const assistant = (data: unknown) => ({
    role: 'assistant',
    parts: [{ type: INTEGRATION_PIN_PART_TYPE, data: [data] }],
  })

  test('reads the latest assistant pin', () => {
    const pin = readIntegrationPin([
      assistant({ peerdb: { ok: false, kind: 'timeout' } }),
      { role: 'user', parts: [] },
      assistant({
        peerdb: { ok: true },
        postgres: { ok: false, kind: 'auth' },
      }),
    ])
    expect(pin).toEqual({
      peerdb: { ok: true },
      postgres: { ok: false, kind: 'auth' },
    })
  })

  test('no pin in history → undefined', () => {
    expect(readIntegrationPin([{ role: 'user', parts: [] }])).toBeUndefined()
  })

  test('ignores a pin on a user message and malformed entries', () => {
    expect(
      readIntegrationPin([
        {
          role: 'user',
          parts: [
            {
              type: INTEGRATION_PIN_PART_TYPE,
              data: [{ peerdb: { ok: true } }],
            },
          ],
        },
      ])
    ).toBeUndefined()
    expect(
      readIntegrationPin([
        assistant({
          peerdb: { ok: 'yes' },
          postgres: { ok: false, kind: 'http://user:pw@host' },
        }),
      ])
    ).toEqual({})
  })
})
