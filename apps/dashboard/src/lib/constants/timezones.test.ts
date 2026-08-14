import { getBrowserTimezone, timezoneLabel } from './timezones'
import { describe, expect, test } from 'bun:test'

describe('timezone helpers', () => {
  test('timezoneLabel maps IANA ids to friendly names', () => {
    expect(timezoneLabel('America/New_York')).toBe('Eastern Time (ET)')
    expect(timezoneLabel('UTC')).toBe('UTC (Coordinated Universal Time)')
  })

  test('timezoneLabel falls back to a readable IANA string', () => {
    expect(timezoneLabel('Pacific/Port_Moresby')).toBe('Pacific/Port Moresby')
  })

  test('getBrowserTimezone returns an IANA-looking id', () => {
    expect(getBrowserTimezone()).toMatch(
      /^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$|^UTC$/
    )
  })
})
