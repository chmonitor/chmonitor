import type { TargetAdapter } from './types'

import { CloudflareAdapter } from './cloudflare-adapter'
import { _resetTargetCache, target } from './index'
import { NodeAdapter } from './node-adapter'
import { parseTarget } from './resolve'
import { describe, expect, test } from 'bun:test'

describe('parseTarget — fail-closed adapter resolution', () => {
  test("only 'cf' selects Cloudflare (case/space-insensitive)", () => {
    expect(parseTarget('cf')).toBe('cloudflare')
    expect(parseTarget('CF')).toBe('cloudflare')
    expect(parseTarget('  cf  ')).toBe('cloudflare')
    expect(parseTarget('Cf')).toBe('cloudflare')
  })

  test('unset / empty / whitespace fails closed to node', () => {
    expect(parseTarget(undefined)).toBe('node')
    expect(parseTarget(null)).toBe('node')
    expect(parseTarget('')).toBe('node')
    expect(parseTarget('   ')).toBe('node')
  })

  test('every other known and junk value fails closed to node', () => {
    for (const value of [
      'docker',
      'helm',
      'dev',
      'unknown',
      'cloudflare', // NOT 'cf' — must not match
      'true',
      'CFF',
      'garbage',
    ]) {
      expect(parseTarget(value)).toBe('node')
    }
  })
})

// Compile-time assertion that both classes satisfy TargetAdapter. If either
// drifts from the interface this file fails to type-check (part of `bun run build`).
const _cfContract: TargetAdapter = new CloudflareAdapter()
const _nodeContract: TargetAdapter = new NodeAdapter()
void _cfContract
void _nodeContract

describe('CloudflareAdapter contract', () => {
  const a = new CloudflareAdapter()

  test('identity + capabilities', () => {
    expect(a.name).toBe('cloudflare')
    expect(a.envSource()).toBe('cloudflare')
    expect(a.capabilities).toEqual({
      d1: true,
      kv: true,
      durableObject: true,
      queue: true,
    })
  })

  test('binding accessors return null when no real binding is present', () => {
    // Under bun test `cloudflare:workers` env is the process.env shim, so a
    // non-object value probes to null.
    expect(a.d1('CHM_CLOUD_D1')).toBeNull()
    expect(a.kv('CHM_VERSION_CACHE_KV')).toBeNull()
    expect(a.durableObject('SOME_DO')).toBeNull()
  })

  test('env() reads string vars', () => {
    const key = 'CHM_TARGET_TEST_ENV_CF'
    process.env[key] = 'hello'
    expect(a.env(key)).toBe('hello')
    delete process.env[key]
    expect(a.env(key)).toBeUndefined()
  })
})

describe('NodeAdapter contract', () => {
  const a = new NodeAdapter()

  test('identity + capabilities (no Cloudflare bindings in production)', () => {
    expect(a.name).toBe('node')
    expect(a.envSource()).toBe('process')
    expect(a.capabilities).toEqual({
      d1: false,
      kv: false,
      durableObject: false,
      queue: false,
    })
  })

  test('binding accessors return null on Node', () => {
    expect(a.d1('CHM_CLOUD_D1')).toBeNull()
    expect(a.kv('CHM_VERSION_CACHE_KV')).toBeNull()
    expect(a.durableObject('SOME_DO')).toBeNull()
  })

  test('env() reads string vars', () => {
    const key = 'CHM_TARGET_TEST_ENV_NODE'
    process.env[key] = 'world'
    expect(a.env(key)).toBe('world')
    delete process.env[key]
  })
})

describe('target() singleton', () => {
  test('resolves to node under bun test (VITE_DEPLOY_TARGET unset) and caches', () => {
    _resetTargetCache()
    const first = target()
    expect(first.name).toBe('node')
    // Cached: same instance on repeated calls.
    expect(target()).toBe(first)
    _resetTargetCache()
    expect(target()).not.toBe(first)
  })
})
