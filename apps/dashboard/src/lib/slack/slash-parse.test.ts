/**
 * Tests for the pure `/chmonitor` subcommand parser (plans/37).
 */

import { parseSlashCommand } from './slash-parse'
import { describe, expect, test } from 'bun:test'

describe('parseSlashCommand', () => {
  test('empty text → help', () => {
    expect(parseSlashCommand('')).toEqual({ sub: 'help', arg: '', hostId: 0 })
    expect(parseSlashCommand('   ')).toEqual({
      sub: 'help',
      arg: '',
      hostId: 0,
    })
  })

  test('unknown subcommand → help (never silently dropped)', () => {
    expect(parseSlashCommand('frobnicate').sub).toBe('help')
  })

  test('status with no host defaults to host 0', () => {
    expect(parseSlashCommand('status')).toEqual({
      sub: 'status',
      arg: '',
      hostId: 0,
    })
  })

  test('status with a numeric host selects it', () => {
    expect(parseSlashCommand('status 2')).toEqual({
      sub: 'status',
      arg: '',
      hostId: 2,
    })
  })

  test('alert is recognized', () => {
    expect(parseSlashCommand('alert').sub).toBe('alert')
  })

  test('query keeps the full remainder as SQL (never parsed as a host)', () => {
    const parsed = parseSlashCommand('query SELECT 1 FROM system.tables')
    expect(parsed.sub).toBe('query')
    expect(parsed.arg).toBe('SELECT 1 FROM system.tables')
    expect(parsed.hostId).toBe(0)
  })

  test('subcommand is case-insensitive', () => {
    expect(parseSlashCommand('STATUS').sub).toBe('status')
    expect(parseSlashCommand('Query SELECT 1').sub).toBe('query')
  })
})
