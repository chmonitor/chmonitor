import { BellRingIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

/** Existing Alert Settings route — not a new product surface (#3291). */
export const ALERTS_HREF = '/alert-settings'
export const ALERTS_TITLE = 'Alerts'

const ALERTS_ITEM: MenuItem = {
  title: ALERTS_TITLE,
  href: ALERTS_HREF,
  description: 'Active notifications for this cluster',
  icon: BellRingIcon,
  permission: { feature: 'health' },
}

function menuContainsHref(items: readonly MenuItem[], href: string): boolean {
  return items.some(
    (item) =>
      item.href === href ||
      (item.items ? menuContainsHref(item.items, href) : false)
  )
}

function insertAlertsChild(health: MenuItem): MenuItem {
  const children = [...(health.items ?? [])]
  const healthPageAt = children.findIndex((child) => child.href === '/health')
  const insertAt = healthPageAt === -1 ? 0 : healthPageAt + 1
  children.splice(insertAt, 0, { ...ALERTS_ITEM })
  return { ...health, items: children }
}

/**
 * Show an Alerts row only while notifications are active. Reuses
 * `/alert-settings` (Active Alerts). No-op when that href is already visible
 * (user restored Alert Settings) or when the count is zero.
 */
export function revealAlertsWhenActive(
  items: readonly MenuItem[],
  hasActiveNotifications: boolean
): MenuItem[] {
  if (!hasActiveNotifications) return items.map((item) => ({ ...item }))
  if (menuContainsHref(items, ALERTS_HREF)) {
    return items.map((item) => ({ ...item }))
  }

  const healthAt = items.findIndex((item) => item.title === 'Health')
  if (healthAt >= 0) {
    return items.map((item, index) =>
      index === healthAt ? insertAlertsChild(item) : { ...item }
    )
  }

  const overviewAt = items.findIndex((item) => item.href === '/overview')
  const alertsLeaf: MenuItem = {
    ...ALERTS_ITEM,
    section: 'main',
  }
  const next = items.map((item) => ({ ...item }))
  next.splice(overviewAt + 1, 0, alertsLeaf)
  return next
}
