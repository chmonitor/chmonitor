/**
 * Pins CloudflarePlatformBindings' binding-resolution contract:
 * - env has the binding -> returned as-is (reference equality)
 * - env lacks the binding, or the context has no env at all -> null
 * - getCloudflareContext() throws -> null, the error never escapes
 *
 * `@opennextjs/cloudflare` is mocked out (this is the ONLY file that should
 * import it, per cloudflare.ts's header comment) so these tests exercise the
 * adapter's own null-swallowing logic in isolation. Plan 96 replaces
 * getCloudflareContext with a different context source; these tests define
 * the public contract that replacement must preserve.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'

const mockGetCloudflareContext = mock((): unknown => undefined)

mock.module('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mockGetCloudflareContext,
}))

// Cache-busting query string gives this describe block its own module
// instance, matching the convention in connection-pool.test.ts /
// table-existence-cache.test.ts to avoid cross-file mock.module pollution
// when the whole package runs as one Bun process (no --isolate).
const { CloudflarePlatformBindings } = await import(
  new URL('./cloudflare.ts?test=cloudflare-adapter', import.meta.url).href
)

describe('CloudflarePlatformBindings', () => {
  let bindings: InstanceType<typeof CloudflarePlatformBindings>

  beforeEach(() => {
    mockGetCloudflareContext.mockReset()
    mockGetCloudflareContext.mockReturnValue(undefined)
    bindings = new CloudflarePlatformBindings()
  })

  describe('getD1Database', () => {
    it('returns the binding as-is when present in env', () => {
      const fakeDb = { __marker: 'd1' } as unknown as D1Database
      mockGetCloudflareContext.mockReturnValue({ env: { MY_DB: fakeDb } })

      expect(bindings.getD1Database('MY_DB')).toBe(fakeDb)
    })

    it('returns null when the binding name is absent from env', () => {
      mockGetCloudflareContext.mockReturnValue({ env: { OTHER_DB: {} } })

      expect(bindings.getD1Database('MY_DB')).toBeNull()
    })

    it('returns null when the context has no env', () => {
      mockGetCloudflareContext.mockReturnValue({})

      expect(bindings.getD1Database('MY_DB')).toBeNull()
    })

    it('returns null when getCloudflareContext() itself returns undefined', () => {
      mockGetCloudflareContext.mockReturnValue(undefined)

      expect(bindings.getD1Database('MY_DB')).toBeNull()
    })

    it('returns null, and does not throw, when getCloudflareContext() throws', () => {
      mockGetCloudflareContext.mockImplementation(() => {
        throw new Error('called outside a request context')
      })

      expect(() => bindings.getD1Database('MY_DB')).not.toThrow()
      expect(bindings.getD1Database('MY_DB')).toBeNull()
    })
  })

  describe('getDurableObjectNamespace', () => {
    it('returns the binding as-is when present in env', () => {
      const fakeNamespace = {
        __marker: 'do',
      } as unknown as DurableObjectNamespace
      mockGetCloudflareContext.mockReturnValue({
        env: { MY_DO: fakeNamespace },
      })

      expect(bindings.getDurableObjectNamespace('MY_DO')).toBe(fakeNamespace)
    })

    it('returns null when the binding name is absent from env', () => {
      mockGetCloudflareContext.mockReturnValue({ env: { OTHER_DO: {} } })

      expect(bindings.getDurableObjectNamespace('MY_DO')).toBeNull()
    })

    it('returns null when the context has no env', () => {
      mockGetCloudflareContext.mockReturnValue({})

      expect(bindings.getDurableObjectNamespace('MY_DO')).toBeNull()
    })

    it('returns null when getCloudflareContext() itself returns undefined', () => {
      mockGetCloudflareContext.mockReturnValue(undefined)

      expect(bindings.getDurableObjectNamespace('MY_DO')).toBeNull()
    })

    it('returns null, and does not throw, when getCloudflareContext() throws', () => {
      mockGetCloudflareContext.mockImplementation(() => {
        throw new Error('called outside a request context')
      })

      expect(() => bindings.getDurableObjectNamespace('MY_DO')).not.toThrow()
      expect(bindings.getDurableObjectNamespace('MY_DO')).toBeNull()
    })
  })
})
