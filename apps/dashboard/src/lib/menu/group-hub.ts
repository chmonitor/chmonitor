import { menuItemsConfig } from '@/menu'

/**
 * Hub page for a top-level sidebar group, if one exists.
 *
 * The one lookup every surface uses (group-row link, breadcrumb crumb, group
 * flyout footer). The mapping itself lives on the menu config as the group's
 * `hubHref`, so there is no second table to keep in sync.
 */
export function getGroupHubHref(groupTitle: string): string | undefined {
  return menuItemsConfig.find(
    (item) => item.title === groupTitle && Boolean(item.items?.length)
  )?.hubHref
}
