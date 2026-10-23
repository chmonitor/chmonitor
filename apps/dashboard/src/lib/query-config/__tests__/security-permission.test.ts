import { describe, expect, test } from 'bun:test'
import { getQueryConfigByName } from '@/lib/query-config'

const SECURITY_CONFIGS = [
  'users',
  'users-with-login',
  'users-basic',
  'user-detail-login',
  'roles',
  'sessions',
  'login-attempts',
]

describe('security configs are gated on the security feature', () => {
  for (const name of SECURITY_CONFIGS) {
    test(`${name} carries the security permission`, () => {
      const config = getQueryConfigByName(name)
      expect(config).toBeDefined()
      expect(config?.permission).toEqual({ feature: 'security' })
    })
  }
})
