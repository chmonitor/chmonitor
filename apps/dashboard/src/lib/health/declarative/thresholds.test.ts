/**
 * Thresholds from `alerts.yaml` reach the sweep/current-findings resolver
 * (#3538). Before the fix the file layer was parsed and then dropped, and the
 * env layer was built with no rule ids, so nothing but raw env applied.
 */

import { _resetHealthConfigCache } from './loader'
import { resolveThresholdOverrides } from './thresholds'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
const saved = { ...process.env }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chm-thr-'))
  process.env.CHM_HEALTH_CONFIG_DIRECTORY = dir
  process.env.SSR = 'true'
  _resetHealthConfigCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.env = { ...saved }
  _resetHealthConfigCache()
})

const write = (yaml: string) => writeFileSync(join(dir, 'alerts.yaml'), yaml)

describe('resolveThresholdOverrides', () => {
  test('a file threshold overrides the default', async () => {
    write('thresholds:\n  disk-usage:\n    warning: 70\n')
    expect(await resolveThresholdOverrides(['disk-usage'])).toEqual({
      'disk-usage': { warning: 70 },
    })
  })

  test('file beats env per field; env fills fields the file omits', async () => {
    write('thresholds:\n  disk-usage:\n    warning: 70\n')
    process.env.HEALTH_THRESHOLD_DISK_USAGE_WARNING = '50'
    process.env.HEALTH_THRESHOLD_DISK_USAGE_CRITICAL = '95'
    expect(await resolveThresholdOverrides(['disk-usage'])).toEqual({
      'disk-usage': { warning: 70, critical: 95 },
    })
  })

  test('a critical-only file threshold leaves the env warning in place', async () => {
    write('thresholds:\n  disk-usage:\n    critical: 99\n')
    process.env.HEALTH_THRESHOLD_DISK_USAGE_WARNING = '60'
    expect(await resolveThresholdOverrides(['disk-usage'])).toEqual({
      'disk-usage': { warning: 60, critical: 99 },
    })
  })

  test('env alone still applies with no file', async () => {
    process.env.HEALTH_THRESHOLD_DISK_USAGE_CRITICAL = '90'
    expect(await resolveThresholdOverrides(['disk-usage'])).toEqual({
      'disk-usage': { critical: 90 },
    })
  })

  test('a threshold for an unknown rule id is dropped', async () => {
    write('thresholds:\n  no-such-rule:\n    warning: 1\n')
    expect(await resolveThresholdOverrides(['disk-usage'])).toEqual({})
  })
})
