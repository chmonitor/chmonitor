import { menuItemsConfig } from '@/menu'

export function getGroupHubHref(groupTitle: string): string | undefined {
  return menuItemsConfig.find(
    (item) => item.title === groupTitle && Boolean(item.items?.length)
  )?.hubHref
}
