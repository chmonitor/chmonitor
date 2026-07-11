import { getEmptyMessage } from './empty-message'
import { describe, expect, test } from 'bun:test'
import { NO_ACTIVE_QUERIES_MESSAGE } from '@/components/query-tables/empty-state'

describe('getEmptyMessage — running-queries table body copy', () => {
  test('returns the "nothing running" message when there are no live or done rows', () => {
    expect(getEmptyMessage(0, 0)).toBe(NO_ACTIVE_QUERIES_MESSAGE)
  })

  test('falls back to the default "no matches" copy when live rows exist but are filtered out', () => {
    expect(getEmptyMessage(3, 0)).toBeUndefined()
  })

  test('falls back to the default copy when only retained Done rows exist', () => {
    expect(getEmptyMessage(0, 1)).toBeUndefined()
  })
})
