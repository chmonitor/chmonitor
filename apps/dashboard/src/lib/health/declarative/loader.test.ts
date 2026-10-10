/**
 * Declarative health config loader (#3496). Exercises the pure functions
 * against real temp directories. The merge itself is #3497; these tests pin
 * the layered, never-throwing contract that merge will build on.
 */

import {
  _resetHealthConfigCache,
  getHealthConfigDirectory,
  getHealthConfigLayers,
  loadHealthConfigFiles,
} from './loader'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
const ENV_KEYS = [
  'HEALTH_THRESHOLD_DISK_USAGE_CRITICAL',
  'HEALTH_ALERT_DIGEST_MINUTES',
  'HEALTH_ALERT_WEBHOOK_TARGETS',
  'OPS_URL',
] as const

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chm-health-config-'))
  _resetHealthConfigCache()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  for (const key of ENV_KEYS) delete process.env[key]
  _resetHealthConfigCache()
})

function write(name: string, contents: string): void {
  writeFileSync(join(dir, name), contents, 'utf-8')
}

describe('getHealthConfigDirectory', () => {
  test('defaults to /etc/chmonitor/health.d', () => {
    expect(getHealthConfigDirectory({})).toBe('/etc/chmonitor/health.d')
  })
  test('reads CHM_HEALTH_CONFIG_DIRECTORY', () => {
    expect(
      getHealthConfigDirectory({ CHM_HEALTH_CONFIG_DIRECTORY: '/x/health.d' })
    ).toBe('/x/health.d')
  })
})

describe('loadHealthConfigFiles — no-op cases', () => {
  test('missing directory is a silent no-op', () => {
    const r = loadHealthConfigFiles(join(dir, 'nope'))
    expect(r.files).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.data.routes).toEqual({})
    expect(r.data.digest).toBeUndefined()
  })
  test('empty directory is a no-op', () => {
    const r = loadHealthConfigFiles(dir)
    expect(r.files).toEqual([])
    expect(r.skipped).toEqual([])
  })
  test('an empty file is a no-op, not an error', () => {
    write('routing.yaml', '')
    const r = loadHealthConfigFiles(dir)
    expect(r.skipped).toEqual([])
    expect(r.data.routes).toEqual({})
  })
})

describe('loadHealthConfigFiles — each concern loads, keyed by its merge key', () => {
  test('all six files', () => {
    write(
      'alerts.yaml',
      `rules:
  - id: slow-merges
    name: Slow merges
    metric: active-mutations
    op: '>'
    warning: 10
    critical: 20
thresholds:
  disk-usage: { warning: 70, critical: 90 }
`
    )
    write(
      'routing.yaml',
      `routes:
  - id: oncall
    matchRule: 'disk-*'
    provider: pagerduty
    target: { serviceName: db }
    secretEnv: PD_ROUTING_KEY
`
    )
    write(
      'channels.yaml',
      `channels:
  - channel: telegram
    target: { chatId: '-100' }
    secretEnv: TG_TOKEN
webhookTargets:
  - id: ops-slack
    name: Ops
    format: slack
    urlEnv: OPS_SLACK_URL
`
    )
    write(
      'quiet-hours.yaml',
      `windows:
  - id: nights
    days: [1, 2, 3, 4, 5]
    start: '22:00'
    end: '06:00'
    timezone: Europe/Berlin
    severityCap: critical
`
    )
    write(
      'maintenance.yaml',
      `windows:
  - id: upgrade
    startsAt: '2026-10-01T00:00:00Z'
    endsAt: '2026-10-01T02:00:00Z'
    reason: upgrade
`
    )
    write('digest.yaml', 'enabled: true\nwindowMinutes: 15\n')

    const r = loadHealthConfigFiles(dir)
    expect(r.skipped).toEqual([])
    expect(r.files).toEqual([
      'alerts',
      'routing',
      'channels',
      'quiet-hours',
      'maintenance',
      'digest',
    ])
    expect(r.data.customRules['slow-merges']?.enabled).toBe(true)
    expect(r.data.thresholds['disk-usage']).toEqual({
      warning: 70,
      critical: 90,
    })
    expect(r.data.routes.oncall).toMatchObject({
      matchHost: '*',
      provider: 'pagerduty',
      secretEnv: 'PD_ROUTING_KEY',
    })
    expect(Object.keys(r.data.channels)).toEqual(['telegram'])
    expect(r.data.webhookTargets['ops-slack']?.urlEnv).toBe('OPS_SLACK_URL')
    expect(r.data.quietHours.nights?.severityCap).toBe('critical')
    expect(r.data.maintenanceWindows.upgrade?.hostId).toBeNull()
    expect(r.data.digest).toEqual({ enabled: true, windowMinutes: 15 })
  })
})

describe('loadHealthConfigFiles — hostile input never throws', () => {
  test('a bad file lands in skipped[] while other files still load', () => {
    write('routing.yaml', 'routes: [ { id: a, provider: webhook\n')
    write('digest.yaml', 'enabled: true\nwindowMinutes: 5\n')
    const r = loadHealthConfigFiles(dir)
    expect(r.skipped.map((s) => s.file)).toEqual(['routing.yaml'])
    expect(r.data.digest).toEqual({ enabled: true, windowMinutes: 5 })
  })

  test('an entry with no id is skipped, never generated', () => {
    write(
      'routing.yaml',
      `routes:
  - provider: webhook
  - id: keep
    provider: webhook
`
    )
    const r = loadHealthConfigFiles(dir)
    expect(Object.keys(r.data.routes)).toEqual(['keep'])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toMatchObject({
      file: 'routing.yaml',
      entry: 'routes[0]',
    })
    expect(r.skipped[0]?.error).toContain('id')
  })

  test('unknown keys are rejected — entry level', () => {
    write(
      'quiet-hours.yaml',
      `windows:
  - id: w
    days: [0]
    start: '01:00'
    end: '02:00'
    severity_cap: critical
`
    )
    const r = loadHealthConfigFiles(dir)
    expect(r.data.quietHours).toEqual({})
    expect(r.skipped[0]?.entry).toBe('windows[0]')
    expect(r.skipped[0]?.error).toContain('severity_cap')
  })

  test('unknown keys are rejected — file level drops the file', () => {
    write('digest.yaml', 'enabled: true\nwindowMinutes: 5\nwindow: 5\n')
    const r = loadHealthConfigFiles(dir)
    expect(r.data.digest).toBeUndefined()
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]?.entry).toBeUndefined()
  })

  test('duplicate keys: first wins, the repeat is skipped', () => {
    write(
      'channels.yaml',
      `channels:
  - channel: email
  - channel: email
    enabled: false
`
    )
    const r = loadHealthConfigFiles(dir)
    expect(r.data.channels.email?.enabled).toBe(true)
    expect(r.skipped[0]?.error).toContain('duplicate')
  })

  test('an unknown file name is reported', () => {
    write('alert.yaml', 'rules: []\n')
    const r = loadHealthConfigFiles(dir)
    expect(r.skipped[0]?.file).toBe('alert.yaml')
  })

  test('a secret-looking value is never echoed into skipped[]', () => {
    write(
      'routing.yaml',
      `routes:
  - id: r
    provider: telegram
    telegramBotToken: 'sk-very-secret'
`
    )
    const r = loadHealthConfigFiles(dir)
    expect(JSON.stringify(r.skipped)).not.toContain('sk-very-secret')
  })

  test('an unknown timezone is rejected at load, not at sweep time', () => {
    write(
      'quiet-hours.yaml',
      "windows:\n  - id: w\n    days: [0]\n    start: '01:00'\n    end: '02:00'\n    timezone: Mars/Olympus\n"
    )
    const r = loadHealthConfigFiles(dir)
    expect(r.data.quietHours).toEqual({})
    expect(r.skipped[0]?.error).toContain('timezone')
  })

  test('webhook target headers follow the X-* rules', () => {
    write(
      'channels.yaml',
      "webhookTargets:\n  - id: t\n    name: T\n    urlEnv: T_URL\n    headers: { Authorization: 'Bearer abc' }\n"
    )
    const r = loadHealthConfigFiles(dir)
    expect(r.data.webhookTargets).toEqual({})
    expect(r.skipped[0]?.error).toContain('Authorization')
    expect(JSON.stringify(r.skipped)).not.toContain('Bearer abc')
  })

  test('custom rule reuses the rule-builder ordering check', () => {
    write(
      'alerts.yaml',
      `rules:
  - id: bad
    name: Bad
    metric: active-mutations
    op: '>'
    warning: 20
    critical: 10
`
    )
    const r = loadHealthConfigFiles(dir)
    expect(r.data.customRules).toEqual({})
    expect(r.skipped[0]?.entry).toBe('rules[0]')
  })
})

describe('getHealthConfigLayers', () => {
  test('returns env then file, tagged, and reuses the existing env parsers', () => {
    process.env.HEALTH_THRESHOLD_DISK_USAGE_CRITICAL = '95'
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '10'
    process.env.OPS_URL = 'https://hooks.example.com/x'
    process.env.HEALTH_ALERT_WEBHOOK_TARGETS = JSON.stringify([
      { name: 'ops', urlEnv: 'OPS_URL' },
    ])
    write('digest.yaml', 'enabled: false\nwindowMinutes: 0\n')

    const { layers, skipped } = getHealthConfigLayers({
      runtimeEnv: { CHM_HEALTH_CONFIG_DIRECTORY: dir },
      ruleIds: ['disk-usage'],
    })
    expect(skipped).toEqual([])
    expect(layers.map((l) => l.source)).toEqual(['env', 'file'])

    const [env, file] = layers
    expect(env?.data.thresholds['disk-usage']).toEqual({ critical: 95 })
    expect(env?.data.digest).toEqual({ enabled: true, windowMinutes: 10 })
    expect(Object.keys(env?.data.webhookTargets ?? {})).toEqual(['env:ops'])
    // Layered, not merged: both sources keep their own digest value.
    expect(file?.data.digest).toEqual({ enabled: false, windowMinutes: 0 })
    expect(file?.source === 'file' && file.directory).toBe(dir)
  })

  test('env layer is empty when no HEALTH_* env is set', () => {
    delete process.env.HEALTH_ALERT_DIGEST_MINUTES
    delete process.env.HEALTH_ALERT_WEBHOOK_TARGETS
    const { layers } = getHealthConfigLayers({
      runtimeEnv: { CHM_HEALTH_CONFIG_DIRECTORY: dir },
    })
    expect(layers[0]?.data.digest).toBeUndefined()
    expect(layers[0]?.data.webhookTargets).toEqual({})
  })

  test('file layer is memoized for the process; reset hook clears it', () => {
    const opts = { runtimeEnv: { CHM_HEALTH_CONFIG_DIRECTORY: dir } }
    expect(getHealthConfigLayers(opts).layers[1]?.data.digest).toBeUndefined()
    write('digest.yaml', 'enabled: true\nwindowMinutes: 3\n')
    expect(getHealthConfigLayers(opts).layers[1]?.data.digest).toBeUndefined()
    _resetHealthConfigCache()
    expect(getHealthConfigLayers(opts).layers[1]?.data.digest).toEqual({
      enabled: true,
      windowMinutes: 3,
    })
  })
})

describe('loadHealthConfigFiles — alerts.yaml peerdbRules (#3699)', () => {
  test('a valid rule loads keyed by id, with defaults filled', () => {
    write(
      'alerts.yaml',
      `peerdbRules:
  - id: fleet-lag
    check: lag
    match: qrep_sg_fleetreporting1_*
    warning: 3600
    critical: 14400
    muteUntil: 2026-10-12T00:00:00Z
`
    )
    const { data, skipped } = loadHealthConfigFiles(dir)
    expect(skipped).toEqual([])
    expect(data.peerdbRules['fleet-lag']).toEqual({
      id: 'fleet-lag',
      check: 'lag',
      matchKind: 'glob',
      match: 'qrep_sg_fleetreporting1_*',
      warning: 3600,
      critical: 14400,
      severity: 'critical',
      enabled: true,
      muteUntil: '2026-10-12T00:00:00Z',
    })
  })

  test('bad entries are skipped one by one; siblings still load', () => {
    write(
      'alerts.yaml',
      `peerdbRules:
  - id: ok
    check: errors
    matchKind: exact
    match: pg_to_ch
    warning: 2
    critical: 10
  - id: inverted
    check: lag
    match: x
    warning: 100
    critical: 10
  - id: unknown-check
    check: cpu
    match: x
    warning: 1
    critical: 2
  - id: typo
    check: lag
    match: x
    warning: 1
    critical: 2
    severty: warning
  - check: lag
    match: no-id
    warning: 1
    critical: 2
  - id: bad-mute
    check: lag
    match: x
    warning: 1
    critical: 2
    muteUntil: tomorrow
`
    )
    const { data, skipped } = loadHealthConfigFiles(dir)
    expect(Object.keys(data.peerdbRules)).toEqual(['ok'])
    expect(skipped.map((s) => s.entry)).toEqual([
      'peerdbRules[1]',
      'peerdbRules[2]',
      'peerdbRules[3]',
      'peerdbRules[4]',
      'peerdbRules[5]',
    ])
  })
})
