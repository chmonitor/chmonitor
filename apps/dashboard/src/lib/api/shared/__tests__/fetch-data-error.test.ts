import { describe, expect, it } from 'bun:test'
import { statusForFetchDataError } from '@/lib/api/shared/fetch-data-error'

describe('statusForFetchDataError', () => {
  // An unreachable upstream must NOT masquerade as a 500. Cloudflare 525/526
  // are classified as ssl_error by the ClickHouse client; this is the exact
  // case behind the production "api 500" report when the CH origin is down.
  it('maps an unreachable upstream to 503, not 500', () => {
    expect(statusForFetchDataError('ssl_error')).toBe(503)
    expect(statusForFetchDataError('network_error')).toBe(503)
  })

  it('maps a slow upstream to 504', () => {
    expect(statusForFetchDataError('timeout_error')).toBe(504)
  })

  it('keeps client-fault classifications', () => {
    expect(statusForFetchDataError('validation_error')).toBe(400)
    expect(statusForFetchDataError('permission_error')).toBe(403)
    expect(statusForFetchDataError('table_not_found')).toBe(404)
    expect(statusForFetchDataError('column_not_found')).toBe(404)
  })

  it('treats a genuine query fault as 500', () => {
    expect(statusForFetchDataError('query_error')).toBe(500)
  })
})
