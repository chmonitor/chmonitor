/**
 * The group flyout answers "where was I in this group?". These tests pin the
 * rules that answer depends on: newest visit first, only this group's pages,
 * pinned pages never repeated under Recent, and a non-empty flyout on day one.
 */

import type { MenuItem } from '@/components/menu/types'

import {
  buildGroupQuickLinks,
  normalizePath,
  type RecentPage,
  recentInGroup,
  recordVisitIn,
} from './recent-pages'
import { describe, expect, test } from 'bun:test'

const item = (href: string): MenuItem => ({ title: href, href }) as MenuItem

const queries = [
  item('/running-queries'),
  item('/history-queries'),
  item('/failed-queries'),
  item('/expensive-queries'),
]

function visit(paths: string[]): readonly RecentPage[] {
  return paths.reduce<readonly RecentPage[]>(
    (acc, path, i) => recordVisitIn(acc, path, i),
    []
  )
}

describe('recordVisitIn', () => {
  test('newest visit first, revisits move to the front without duplicates', () => {
    const entries = visit(['/a', '/b', '/a'])
    expect(entries.map((e) => e.path)).toEqual(['/a', '/b'])
    expect(entries[0]?.at).toBe(2)
  })

  test('revisiting the newest page keeps the same array (no store churn)', () => {
    const entries = visit(['/a'])
    expect(recordVisitIn(entries, '/a/', 99)).toBe(entries)
  })

  test('caps history so localStorage cannot grow unbounded', () => {
    const entries = visit(['/1', '/2', '/3', '/4'])
    expect(recordVisitIn(entries, '/5', 5, 3).map((e) => e.path)).toEqual([
      '/5',
      '/4',
      '/3',
    ])
  })

  test('normalizes query, hash and trailing slash', () => {
    expect(normalizePath('/keeper/?path=/x#y')).toBe('/keeper')
    expect(normalizePath('/')).toBe('/')
  })
})

describe('recentInGroup', () => {
  test('keeps only this group, newest first, at most the limit', () => {
    const entries = visit([
      '/running-queries',
      '/tables',
      '/failed-queries',
      '/history-queries',
    ])
    expect(recentInGroup(entries, queries).map((i) => i.href)).toEqual([
      '/history-queries',
      '/failed-queries',
      '/running-queries',
    ])
    expect(recentInGroup(entries, queries, 1).map((i) => i.href)).toEqual([
      '/history-queries',
    ])
  })

  test('matches a child whose href carries a query by path', () => {
    const keeper = item('/keeper?path=/')
    expect(recentInGroup(visit(['/keeper']), [keeper])).toEqual([keeper])
  })
})

describe('buildGroupQuickLinks', () => {
  test('pinned first in pin order; recent drops anything already pinned', () => {
    const entries = visit(['/running-queries', '/failed-queries'])
    const links = buildGroupQuickLinks(
      queries,
      ['/failed-queries', '/tables', '/history-queries'],
      entries
    )
    expect(links.pinned.map((i) => i.href)).toEqual([
      '/failed-queries',
      '/history-queries',
    ])
    expect(links.recent.map((i) => i.href)).toEqual(['/running-queries'])
    expect(links.fallback).toEqual([])
  })

  test('empty state falls back to the top 3 pages of the group', () => {
    const links = buildGroupQuickLinks(queries, [], visit(['/tables']))
    expect(links.pinned).toEqual([])
    expect(links.recent).toEqual([])
    expect(links.fallback.map((i) => i.href)).toEqual([
      '/running-queries',
      '/history-queries',
      '/failed-queries',
    ])
  })
})
