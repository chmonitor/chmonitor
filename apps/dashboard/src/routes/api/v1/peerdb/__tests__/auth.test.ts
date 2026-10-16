/**
 * PeerDB routes forward to a flow-api with a server-held credential (`$`) or
 * dial a caller-supplied URL (`validate`), so an anonymous caller must be
 * rejected under Clerk + public read (cloud mode). Auth `none` stays open.
 * Uses the real isAuthenticatedRequest so a handler that skips it fails here.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { __handleForTests: proxy } = await import('../$')
const { __handlePostForTests: validate } = await import('../validate')

const KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_API_KEY_SECRET',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function cloudMode() {
  process.env.CHM_AUTH_PROVIDER = 'clerk'
  process.env.CHM_CLERK_PUBLIC_READ = 'true'
}

const base = 'https://dash.example.com/api/v1/peerdb'
const listReq = () => new Request(`${base}/mirrors/list`)
const validateReq = () =>
  new Request(`${base}/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

describe('peerdb auth guard', () => {
  test('proxy rejects an anonymous cloud-mode caller', async () => {
    cloudMode()
    const res = await proxy('GET', listReq(), 'mirrors/list')
    expect(res.status).toBe(401)
  })

  test('validate rejects an anonymous cloud-mode caller', async () => {
    cloudMode()
    const res = await validate(validateReq())
    expect(res.status).toBe(401)
  })

  test('proxy with auth none reaches the handler (unconfigured -> 503)', async () => {
    const res = await proxy('GET', listReq(), 'mirrors/list')
    expect(res.status).toBe(503)
  })

  test('validate with auth none reaches the handler (no apiUrl -> 400)', async () => {
    const res = await validate(validateReq())
    expect(res.status).toBe(400)
  })
})
