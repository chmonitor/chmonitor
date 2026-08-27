import type { MenuItem } from '@/components/menu/types'

/**
 * Group titles that are folders, not the destination name. Flattening uses
 * the child's title (Chat, SQL Console) instead of the folder name.
 */
const FOLDER_TITLES = new Set(['AI Agent', 'Tools'])

/**
 * Label for a 1-child group on the Essential rail: parent title for
 * Queries / Tables / Health, child title for folder groups, and "SQL"
 * for the Tools → SQL Console singleton.
 */
export function flattenSingletonTitle(
  parent: MenuItem,
  child: MenuItem
): string {
  if (parent.title === 'Tools' && child.href === '/sql') return 'SQL'
  if (FOLDER_TITLES.has(parent.title)) return child.title
  return parent.title
}

/**
 * Render a group with 0–1 visible children as a leaf (no chevron). Empty
 * parents are already dropped by hide/engine filters; a single child is
 * hoisted to the parent's section with a short rail label.
 *
 * Does not recurse — only top-level groups flatten. Footer rows are left
 * alone. Groups with 2+ children keep their chevron.
 */
export function flattenSingletonGroups(items: readonly MenuItem[]): MenuItem[] {
  return items.map((item) => {
    if (item.section === 'footer') return { ...item }
    const children = item.items
    if (!children || children.length !== 1) {
      return { ...item, items: children ? [...children] : undefined }
    }

    const child = children[0]
    if (child.items?.length) {
      return { ...item, items: [{ ...child }] }
    }

    return {
      ...child,
      title: flattenSingletonTitle(item, child),
      icon: FOLDER_TITLES.has(item.title)
        ? (child.icon ?? item.icon)
        : (item.icon ?? child.icon),
      section: item.section ?? child.section,
      items: undefined,
    }
  })
}
