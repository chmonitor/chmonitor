import type { MenuItem } from '@/components/menu/types'

/**
 * Unused on the live sidebar (#3348). Essential keeps parent/child groups
 * even when a group has one visible child, so hover + can nest hidden
 * siblings under that parent. Helper stays unit-tested in case another
 * surface wants a flat label.
 */

/** Group titles that are folders; flattening uses the child's title. */
const FOLDER_TITLES = new Set(['AI Agent', 'Tools'])

/**
 * Short label for a 1-child group: parent title for Queries / Tables /
 * Health, child title for folder groups, and "SQL" for Tools → SQL Console.
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
