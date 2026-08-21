import { resolveCliAuthDiscovery } from '../cli-auth-discovery'
import { describe, expect, it } from 'bun:test'

describe('resolveCliAuthDiscovery', () => {
  it('method=none when auth=none and no API key secret (open API)', () => {
    const d = resolveCliAuthDiscovery({
      CHM_AUTH_PROVIDER: 'none',
      CHM_CLOUD_MODE: 'false',
    })
    expect(d.method).toBe('none')
    expect(d.api).toBe('open')
    expect(d.authProvider).toBe('none')
    expect(d.deviceLogin.enabled).toBe(false)
    expect(d.hint).toMatch(/open/i)
  })

  it('method=device when device login is enabled (cloud + secret)', () => {
    const d = resolveCliAuthDiscovery({
      CHM_CLOUD_MODE: 'true',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'clerk',
      CHM_CLOUD_D1: '1',
    })
    expect(d.method).toBe('device')
    expect(d.api).toBe('key_required')
    expect(d.authProvider).toBe('clerk')
    expect(d.deviceLogin.enabled).toBe(true)
    expect(d.deviceLogin.deviceOnly).toBe(false)
    expect(d.hint).toMatch(/device/i)
  })

  it('method=device for self-hosted opt-in (device-only)', () => {
    const d = resolveCliAuthDiscovery({
      CHM_DEVICE_LOGIN: 'true',
      CHM_CLOUD_MODE: 'false',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'none',
    })
    expect(d.method).toBe('device')
    expect(d.api).toBe('key_required')
    expect(d.deviceLogin.enabled).toBe(true)
    expect(d.deviceLogin.deviceOnly).toBe(true)
    expect(d.hint).toMatch(/device-only/i)
  })

  it('method=api_key when secret set but device login off (OSS default)', () => {
    const d = resolveCliAuthDiscovery({
      CHM_AUTH_PROVIDER: 'none',
      CHM_CLOUD_MODE: 'false',
      CHM_API_KEY_SECRET: 'secret',
    })
    expect(d.method).toBe('api_key')
    expect(d.api).toBe('key_required')
    expect(d.deviceLogin.enabled).toBe(false)
    expect(d.hint).toMatch(/API key/i)
  })

  it('prefers device over api_key when both would apply', () => {
    const d = resolveCliAuthDiscovery({
      CHM_DEVICE_LOGIN: 'true',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'none',
      CHM_CLOUD_MODE: 'false',
    })
    expect(d.method).toBe('device')
  })

  it('cloud deployment mode without explicit provider → clerk + device when secret', () => {
    const d = resolveCliAuthDiscovery({
      CHM_DEPLOYMENT_MODE: 'cloud',
      CHM_CLOUD_MODE: 'true',
      CHM_API_KEY_SECRET: 'secret',
    })
    expect(d.authProvider).toBe('clerk')
    expect(d.method).toBe('device')
  })
})
