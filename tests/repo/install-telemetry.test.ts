/**
 * scripts/install.sh sends one anonymous `cli_install` event to the shared
 * telemetry service. This runs the real `send_install_ping` function with a
 * stub `curl` on PATH (no network) and checks what it would have sent, and that
 * every opt-out still stops it.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const INSTALL_SH = readFileSync(
  resolve(import.meta.dir, '../../scripts/install.sh'),
  'utf8'
)
const FN = INSTALL_SH.match(/^send_install_ping\(\) \{\n[\s\S]*?\n\}$/m)?.[0]

const work = mkdtempSync(join(tmpdir(), 'chm-install-tel-'))
const out = join(work, 'curl-args')
writeFileSync(join(work, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\n`)
chmodSync(join(work, 'curl'), 0o755)
afterAll(() => rmSync(work, { recursive: true, force: true }))

/** Run send_install_ping; returns the curl args it would have used, or null. */
function run(env: Record<string, string> = {}): string[] | null {
  rmSync(out, { force: true })
  const baseEnv = { ...process.env }
  for (const k of [
    'CI',
    'DO_NOT_TRACK',
    'CHM_TELEMETRY',
    'CHM_TELEMETRY_ENDPOINT',
  ]) {
    delete baseEnv[k]
  }
  const res = spawnSync('sh', ['-c', `${FN}\nsend_install_ping`], {
    env: {
      ...baseEnv,
      ...env,
      PATH: `${work}:${process.env.PATH}`,
      VERSION: 'chm-v0.1.4',
    },
  })
  expect(res.status).toBe(0)
  return existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n') : null
}

describe('install.sh telemetry', () => {
  test('found the send_install_ping function', () => {
    expect(FN).toBeDefined()
  })

  test('posts a cli_install event to the shared service, with the command in props', () => {
    const args = run()
    expect(args).not.toBeNull()
    expect(args?.at(-1)).toBe('https://telemetry.anyr.workers.dev/chmonitor')
    const body = JSON.parse(args?.[args.indexOf('--data') + 1] ?? '{}')
    expect(body).toMatchObject({
      event: 'cli_install',
      version: '0.1.4',
      props: { command: 'install' },
    })
    expect(Object.keys(body).sort()).toEqual([
      'arch',
      'event',
      'id',
      'os',
      'props',
      'version',
    ])
    // One-shot installs carry a fresh random id, never a persisted identity.
    expect(body.id).toMatch(/^[0-9a-f]{64}$/)
  })

  test.each([
    ['CI', { CI: '1' }],
    ['DO_NOT_TRACK', { DO_NOT_TRACK: '1' }],
    ['CHM_TELEMETRY=off', { CHM_TELEMETRY: 'off' }],
    ['empty CHM_TELEMETRY_ENDPOINT', { CHM_TELEMETRY_ENDPOINT: '' }],
  ])('sends nothing under %s', (_name, env) => {
    expect(run(env)).toBeNull()
  })
})
