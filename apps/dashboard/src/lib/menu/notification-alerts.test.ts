import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  ALERTS_HREF,
  ALERTS_TITLE,
  revealAlertsWhenActive,
} from '@/lib/menu/notification-alerts'

const leaf = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  title: overrides.title ?? 'Item',
  href: overrides.href ?? '/item',
  ...overrides,
})

const healthGroup = (): MenuItem => ({
  title: 'Health',
  href: '',
  section: 'main',
  items: [
    leaf({ title: 'Health', href: '/health' }),
    leaf({ title: 'Health Settings', href: '/health-settings' }),
  ],
})

const catalog = (): MenuItem[] => [
  leaf({ title: 'Overview', href: '/overview', section: 'main' }),
  healthGroup(),
  leaf({ title: 'About', href: '/about', section: 'footer' }),
]

describe('revealAlertsWhenActive (#3291)', () => {
  test('does not add Alerts when the notification count is zero', () => {
    const result = revealAlertsWhenActive(catalog(), false)
    expect(
      result.find((item) => item.title === 'Health')?.items?.map((i) => i.title)
    ).toEqual(['Health', 'Health Settings'])
    expect(JSON.stringify(result)).not.toContain(ALERTS_TITLE)
  })

  test('inserts Alerts under Health after the Health page when count > 0', () => {
    const result = revealAlertsWhenActive(catalog(), true)
    const health = result.find((item) => item.title === 'Health')
    expect(health?.items?.map((item) => item.title)).toEqual([
      'Health',
      ALERTS_TITLE,
      'Health Settings',
    ])
    expect(
      health?.items?.find((item) => item.title === ALERTS_TITLE)?.href
    ).toBe(ALERTS_HREF)
  })

  test('does not duplicate when Alert Settings is already visible', () => {
    const withSettings: MenuItem[] = [
      leaf({ title: 'Overview', href: '/overview', section: 'main' }),
      {
        title: 'Health',
        href: '',
        items: [
          leaf({ title: 'Health', href: '/health' }),
          leaf({ title: 'Alert Settings', href: ALERTS_HREF }),
        ],
      },
    ]
    const result = revealAlertsWhenActive(withSettings, true)
    const hrefs =
      result
        .find((item) => item.title === 'Health')
        ?.items?.map((item) => item.href) ?? []
    expect(hrefs.filter((href) => href === ALERTS_HREF)).toEqual([ALERTS_HREF])
    expect(
      result
        .find((item) => item.title === 'Health')
        ?.items?.map((item) => item.title)
    ).not.toContain(ALERTS_TITLE)
  })

  test('inserts a top-level Alerts row after Overview when Health is absent', () => {
    const withoutHealth: MenuItem[] = [
      leaf({ title: 'Overview', href: '/overview', section: 'main' }),
      leaf({ title: 'Queries', href: '/running-queries', section: 'main' }),
    ]
    const result = revealAlertsWhenActive(withoutHealth, true)
    expect(result.map((item) => item.title)).toEqual([
      'Overview',
      ALERTS_TITLE,
      'Queries',
    ])
    expect(result[1]?.href).toBe(ALERTS_HREF)
    expect(result[1]?.section).toBe('main')
  })
})
