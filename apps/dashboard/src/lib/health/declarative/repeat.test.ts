/**
 * `alerts.yaml` `repeat:` reaches the sweep's pacing config (#4049) with the
 * same file > env precedence as thresholds.
 */

import { _resetHealthConfigCache, loadHealthConfigFiles } from './loader'
import { resolveRepeatConfig } from './repeat'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
const saved = { ...process.env }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chm-repeat-'))
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
const IDS = ['disk-usage', 'replication-lag']

describe('alerts.yaml repeat', () => {
  test('loads every key and resolves it', async () => {
    write(
      [
        'repeat:',
        '  cooldownMinutes:',
        '    warning: 120',
        '    critical: 15',
        '  minDelta: 2',
        '  minDeltaByRule:',
        '    disk-usage: 10',
        '  backoffMaxMinutes: 240',
      ].join('\n')
    )
    const r = await resolveRepeatConfig(IDS)
    expect(r.bySeverity).toEqual({ warning: 7_200_000, critical: 900_000 })
    expect(r.repeatMinDelta).toEqual({
      default: 2,
      byRule: { 'disk-usage': 10, 'replication-lag': 2 },
    })
    expect(r.repeatBackoffMaxMs).toBe(240 * 60_000)
  })

  test('no file and no env leaves everything off', async () => {
    expect(await resolveRepeatConfig(IDS)).toEqual({
      bySeverity: {},
      repeatMinDelta: {
        default: null,
        byRule: { 'disk-usage': null, 'replication-lag': null },
      },
      repeatBackoffMaxMs: null,
    })
  })

  test('file beats env per key; env fills keys the file omits', async () => {
    write('repeat:\n  cooldownMinutes:\n    critical: 5\n  minDelta: 1\n')
    process.env.HEALTH_ALERT_COOLDOWN_CRITICAL_MINUTES = '30'
    process.env.HEALTH_ALERT_COOLDOWN_WARNING_MINUTES = '90'
    process.env.HEALTH_ALERT_REPEAT_MIN_DELTA = '9'
    process.env.HEALTH_ALERT_BACKOFF_MAX_MINUTES = '60'
    const r = await resolveRepeatConfig(IDS)
    expect(r.bySeverity).toEqual({ critical: 300_000, warning: 5_400_000 })
    expect(r.repeatMinDelta.default).toBe(1)
    expect(r.repeatBackoffMaxMs).toBe(3_600_000)
  })

  test('env per-rule min delta beats the file global; file per-rule beats env per-rule', async () => {
    write('repeat:\n  minDelta: 1\n  minDeltaByRule:\n    replication-lag: 7\n')
    process.env.HEALTH_ALERT_REPEAT_MIN_DELTA_DISK_USAGE = '4'
    process.env.HEALTH_ALERT_REPEAT_MIN_DELTA_REPLICATION_LAG = '99'
    const r = await resolveRepeatConfig(IDS)
    expect(r.repeatMinDelta.byRule).toEqual({
      'disk-usage': 4,
      'replication-lag': 7,
    })
  })

  test('env alone still applies', async () => {
    process.env.HEALTH_ALERT_BACKOFF_MAX_MINUTES = '30'
    expect((await resolveRepeatConfig(IDS)).repeatBackoffMaxMs).toBe(1_800_000)
  })

  test('invalid values skip the whole repeat block and keep env', () => {
    write('repeat:\n  backoffMaxMinutes: 0\n')
    const result = loadHealthConfigFiles(dir)
    expect(result.data.repeat).toBeUndefined()
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.entry).toBe('repeat')
  })

  test('unknown rule ids in minDeltaByRule are ignored', async () => {
    write('repeat:\n  minDeltaByRule:\n    nope: 3\n')
    const r = await resolveRepeatConfig(IDS)
    expect(r.repeatMinDelta.byRule).toEqual({
      'disk-usage': null,
      'replication-lag': null,
    })
  })
})
