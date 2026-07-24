/**
 * Activation — the signup → connected-a-cluster conversion line.
 */

import type { D1SummaryDb } from './summary'

import {
  activationLines,
  activationRate,
  collectActivation,
  isStalled,
  STALL_MIN_SIGNUPS,
} from './activation'
import { describe, expect, test } from 'bun:test'

const SINCE = Math.floor(Date.parse('2026-07-24T00:00:00Z') / 1000)

function fakeDb(row: unknown): D1SummaryDb {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all<T>() {
              return { results: [] as T[] }
            },
            async first<T>() {
              return row as T
            },
          }
        },
      }
    },
  }
}

describe('activationRate', () => {
  test('is activated users over signups', () => {
    expect(
      activationRate({ newConnections: 5, activatedUsers: 3, signups: 8 })
    ).toBe(37.5)
  })

  test('is null without a denominator, rather than a misleading 0%', () => {
    expect(
      activationRate({ newConnections: 0, activatedUsers: 0, signups: 0 })
    ).toBeNull()
    expect(
      activationRate({ newConnections: 2, activatedUsers: 1, signups: null })
    ).toBeNull()
  })
})

describe('isStalled', () => {
  test('flags signups with nobody connecting anything', () => {
    expect(
      isStalled({
        newConnections: 0,
        activatedUsers: 0,
        signups: STALL_MIN_SIGNUPS,
      })
    ).toBe(true)
  })

  test('does not flag a quiet day with one or two signups', () => {
    // At tiny volumes "nobody connected" is ordinary, not a broken funnel.
    expect(
      isStalled({ newConnections: 0, activatedUsers: 0, signups: 1 })
    ).toBe(false)
  })

  test('does not flag when someone did connect', () => {
    expect(
      isStalled({ newConnections: 1, activatedUsers: 1, signups: 10 })
    ).toBe(false)
  })
})

describe('collectActivation', () => {
  test('counts connections and the distinct users behind them', async () => {
    const data = await collectActivation(fakeDb({ n: 5, users: 3 }), SINCE, 8)
    expect(data).toEqual({
      newConnections: 5,
      activatedUsers: 3,
      signups: 8,
    })
  })

  test('returns null without a database', async () => {
    expect(await collectActivation(null, SINCE, 8)).toBeNull()
  })

  test('returns null and logs on a query failure', async () => {
    const boom: D1SummaryDb = {
      prepare() {
        return {
          bind() {
            return {
              all<T>(): Promise<{ results: T[] }> {
                throw new Error('nope')
              },
              first<T>(): Promise<T | null> {
                throw new Error('no such table: user_connections')
              },
            }
          },
        }
      },
    }
    const logged: string[] = []
    expect(
      await collectActivation(boom, SINCE, 8, (m) => logged.push(m))
    ).toBeNull()
    expect(logged).toHaveLength(1)
  })
})

describe('activationLines', () => {
  test('reports the rate against signups', () => {
    const text = activationLines({
      newConnections: 5,
      activatedUsers: 3,
      signups: 8,
    }).join('\n')
    expect(text).toContain('Activation')
    expect(text).toContain('3 of 8 signups (37.5%)')
  })

  test('calls out a stalled funnel explicitly', () => {
    const text = activationLines({
      newConnections: 0,
      activatedUsers: 0,
      signups: 6,
    }).join('\n')
    expect(text).toContain('6 signups, zero connected')
  })

  test('is empty when unavailable so the caller can spread it', () => {
    expect(activationLines(null)).toEqual([])
  })
})
