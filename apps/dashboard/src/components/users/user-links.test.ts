import { menuItemsConfig } from '@/menu'

import { buildUserLinks, buildUsersRelatedLinks } from './user-links'
import { describe, expect, test } from 'bun:test'
import { flattenMenuItems } from '@/lib/menu/derive-favorites'

function params(href: string): URLSearchParams {
  return new URL(href, 'http://x').searchParams
}

function byKey(links: ReturnType<typeof buildUserLinks>, key: string) {
  const link = links.find((l) => l.key === key)
  if (!link) throw new Error(`missing link ${key}`)
  return link
}

describe('buildUserLinks', () => {
  // A name with URL-special characters proves the user survives encoding.
  const user = 'svc a&b=c'
  const links = buildUserLinks(3, user)

  test('every link keeps the current host', () => {
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(params(link.href).get('host')).toBe('3')
    }
  })

  test('pages with a user filter are pre-filtered to that user', () => {
    expect(params(byKey(links, 'usage').href).get('user')).toBe(user)
    expect(params(byKey(links, 'history').href).get('user')).toBe(`eq:${user}`)
    expect(params(byKey(links, 'running').href).get('user')).toBe(`eq:${user}`)
  })

  test('history links clear the default excluded users so service accounts show', () => {
    expect(params(byKey(links, 'history').href).get('excluded_users')).toBe('')
  })

  test('failed queries filter history by user and failure types', () => {
    const p = params(byKey(links, 'failed').href)
    expect(p.get('user')).toBe(`eq:${user}`)
    expect(p.get('type')).toBe(
      'in:ExceptionBeforeStart,ExceptionWhileProcessing'
    )
  })

  test('pages without a user filter get no invented user param', () => {
    for (const key of [
      'roles',
      'access-matrix',
      'sessions',
      'login-attempts',
    ]) {
      expect(params(byKey(links, key).href).has('user')).toBe(false)
    }
  })

  test('every link is gated by a real menu entry', () => {
    const hrefs = new Set(
      flattenMenuItems(menuItemsConfig).map((item) => item.href)
    )
    for (const link of [...links, ...buildUsersRelatedLinks(0)]) {
      expect(hrefs.has(link.menuHref)).toBe(true)
    }
  })
})

describe('buildUsersRelatedLinks', () => {
  test('header links carry the host and no user', () => {
    const links = buildUsersRelatedLinks(1)
    expect(links.map((l) => l.key)).toEqual([
      'roles',
      'access-matrix',
      'sessions',
      'usage',
    ])
    for (const link of links) {
      expect(params(link.href).get('host')).toBe('1')
      expect(params(link.href).has('user')).toBe(false)
    }
  })
})
