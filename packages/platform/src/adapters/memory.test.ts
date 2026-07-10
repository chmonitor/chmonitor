/**
 * Pins MemoryPlatformBindings' contract: every binding lookup returns null,
 * unconditionally, for both methods. This is the non-Cloudflare fallback
 * (dev/tests/self-hosted without D1) that every D1-backed store degrades to
 * "not configured" against.
 *
 * Deviation from the plan: the plan's step 2 asked to test a "seeding
 * interface" (get-after-set) on this adapter. There isn't one -- the current
 * memory.ts carries no state at all and always returns null (see the file's
 * own header comment). Per the plan's own scope ("no production changes" /
 * "out of scope: production adapter code") and STOP condition ("do not
 * refactor production code for testability here"), this suite tests the
 * actual always-null contract instead of adding an unrequested seeding API.
 */

import type { PlatformBindings } from '../types'

import { MemoryPlatformBindings } from './memory'
import { describe, expect, it } from 'bun:test'

describe('MemoryPlatformBindings', () => {
  it('implements the PlatformBindings contract', () => {
    const bindings: PlatformBindings = new MemoryPlatformBindings()

    expect(typeof bindings.getD1Database).toBe('function')
    expect(typeof bindings.getDurableObjectNamespace).toBe('function')
  })

  describe('getD1Database', () => {
    it('returns null for a realistic binding name', () => {
      const bindings = new MemoryPlatformBindings()

      expect(bindings.getD1Database('CHM_CLOUD_D1')).toBeNull()
    })

    it('returns null for an empty binding name', () => {
      const bindings = new MemoryPlatformBindings()

      expect(bindings.getD1Database('')).toBeNull()
    })

    it('returns null consistently across repeated and differing calls', () => {
      const bindings = new MemoryPlatformBindings()

      expect(bindings.getD1Database('CHM_CLOUD_D1')).toBeNull()
      expect(bindings.getD1Database('CHM_CLOUD_D1')).toBeNull()
      expect(bindings.getD1Database('SOME_OTHER_DB')).toBeNull()
    })
  })

  describe('getDurableObjectNamespace', () => {
    it('returns null for a realistic binding name', () => {
      const bindings = new MemoryPlatformBindings()

      expect(
        bindings.getDurableObjectNamespace('AGENT_CONVERSATIONS_DO')
      ).toBeNull()
    })

    it('returns null for an empty binding name', () => {
      const bindings = new MemoryPlatformBindings()

      expect(bindings.getDurableObjectNamespace('')).toBeNull()
    })

    it('returns null consistently across repeated and differing calls', () => {
      const bindings = new MemoryPlatformBindings()

      expect(
        bindings.getDurableObjectNamespace('AGENT_CONVERSATIONS_DO')
      ).toBeNull()
      expect(
        bindings.getDurableObjectNamespace('AGENT_CONVERSATIONS_DO')
      ).toBeNull()
      expect(bindings.getDurableObjectNamespace('SOME_OTHER_DO')).toBeNull()
    })
  })
})
