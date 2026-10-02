// verify-deploy must stay deployable while the monitored ClickHouse is down
// (#3487), yet still fail when OUR worker 500s against a healthy host (#3530).

import { isUpstreamDown } from './verify-deploy-upstream'
import { describe, expect, test } from 'bun:test'

describe('isUpstreamDown', () => {
  test('host-status 5xx with success:false → upstream outage, not a broken deploy', () => {
    for (const status of [500, 503, 504]) {
      expect(
        isUpstreamDown({
          kind: 'response',
          status,
          json: { success: false, error: 'connect ECONNREFUSED' },
        })
      ).toBe(true)
    }
  })

  test('host-status timeout → upstream hung', () => {
    expect(isUpstreamDown({ kind: 'timeout' })).toBe(true)
  })

  test('host-status 200 → host is up, so a menu-counts 500 is our bug', () => {
    expect(
      isUpstreamDown({
        kind: 'response',
        status: 200,
        json: { success: true, data: { version: '26.4' } },
      })
    ).toBe(false)
  })

  test('non-JSON 5xx (worker crash / CF error page) is not excused', () => {
    expect(isUpstreamDown({ kind: 'response', status: 502, json: null })).toBe(
      false
    )
  })

  test('4xx or network error reaching the worker is not excused', () => {
    expect(
      isUpstreamDown({
        kind: 'response',
        status: 400,
        json: { success: false, error: 'bad hostId' },
      })
    ).toBe(false)
    expect(isUpstreamDown({ kind: 'error', message: 'ENOTFOUND' })).toBe(false)
  })
})
