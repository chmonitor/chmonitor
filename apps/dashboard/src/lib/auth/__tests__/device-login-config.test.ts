import {
  parseDeviceLoginMode,
  resolveDeviceLogin,
} from '../device-login-config'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const ENV_KEYS = [
  'CHM_DEVICE_LOGIN',
  'CHM_DEVICE_LOGIN_SUBJECT',
  'CHM_API_KEY_SECRET',
  'CHM_CLOUD_MODE',
  'CHM_DEPLOYMENT_MODE',
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_CLOUD_D1',
] as const

describe('parseDeviceLoginMode', () => {
  it('defaults unset/junk to auto', () => {
    expect(parseDeviceLoginMode(undefined)).toBe('auto')
    expect(parseDeviceLoginMode('')).toBe('auto')
    expect(parseDeviceLoginMode('auto')).toBe('auto')
    expect(parseDeviceLoginMode('maybe')).toBe('auto')
  })

  it('parses true/false aliases', () => {
    expect(parseDeviceLoginMode('true')).toBe('true')
    expect(parseDeviceLoginMode('1')).toBe('true')
    expect(parseDeviceLoginMode('YES')).toBe('true')
    expect(parseDeviceLoginMode('false')).toBe('false')
    expect(parseDeviceLoginMode('0')).toBe('false')
    expect(parseDeviceLoginMode('off')).toBe('false')
  })
})

describe('resolveDeviceLogin', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('auto + OSS → disabled (internal network default)', () => {
    const status = resolveDeviceLogin({
      CHM_CLOUD_MODE: 'false',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'none',
    })
    expect(status.mode).toBe('auto')
    expect(status.enabled).toBe(false)
    expect(status.reason).toBe('disabled')
    expect(status.deviceOnly).toBe(false)
  })

  it('auto + cloud + secret → enabled with Clerk (not device-only)', () => {
    const status = resolveDeviceLogin({
      CHM_CLOUD_MODE: 'true',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'clerk',
      CHM_CLOUD_D1: '1',
    })
    expect(status.enabled).toBe(true)
    expect(status.deviceOnly).toBe(false)
    expect(status.store).toBe('d1')
  })

  it('auto + cloud without secret → disabled missing_api_key_secret', () => {
    const status = resolveDeviceLogin({
      CHM_CLOUD_MODE: 'true',
      CHM_AUTH_PROVIDER: 'clerk',
    })
    expect(status.enabled).toBe(false)
    expect(status.reason).toBe('missing_api_key_secret')
  })

  it('true + OSS + secret + auth=none → device-only enabled (memory store)', () => {
    const status = resolveDeviceLogin({
      CHM_DEVICE_LOGIN: 'true',
      CHM_CLOUD_MODE: 'false',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'none',
    })
    expect(status.enabled).toBe(true)
    expect(status.deviceOnly).toBe(true)
    expect(status.store).toBe('memory')
    expect(status.subject).toBe('self-hosted')
  })

  it('respects CHM_DEVICE_LOGIN_SUBJECT', () => {
    const status = resolveDeviceLogin({
      CHM_DEVICE_LOGIN: 'true',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'none',
      CHM_DEVICE_LOGIN_SUBJECT: 'ops-lan',
    })
    expect(status.subject).toBe('ops-lan')
  })

  it('false forces off even in cloud', () => {
    const status = resolveDeviceLogin({
      CHM_DEVICE_LOGIN: 'false',
      CHM_CLOUD_MODE: 'true',
      CHM_API_KEY_SECRET: 'secret',
      CHM_AUTH_PROVIDER: 'clerk',
    })
    expect(status.enabled).toBe(false)
    expect(status.reason).toBe('disabled')
  })
})
