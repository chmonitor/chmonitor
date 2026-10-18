/**
 * Hub pages follow the user's Hide settings. A page is "hidden" when the user
 * hid its href (workspace) or the Unavailable-pages setting resolves it to
 * `hidden`. Hidden pages are left out of the card grids and counted, so the
 * hub can offer one "Show N hidden pages" link. Keep React out of this file.
 */

import type { MenuItem } from '@/components/menu/types'
import type { HubSection } from '@/lib/menu/hub'
import type { UnavailableVisibility } from '@/lib/menu/unavailable-visibility'

export interface HubVisibilityInput {
  hiddenHrefs: ReadonlySet<string>
  visibilityOf: (item: MenuItem) => UnavailableVisibility
  showHidden: boolean
}

export interface HubVisibilityResult {
  sections: HubSection[]
  hiddenCount: number
}

export function isHubItemHidden(
  item: MenuItem,
  {
    hiddenHrefs,
    visibilityOf,
  }: Pick<HubVisibilityInput, 'hiddenHrefs' | 'visibilityOf'>
): boolean {
  return hiddenHrefs.has(item.href) || visibilityOf(item) === 'hidden'
}

/**
 * Drop hidden pages from each section (unless `showHidden`), and drop sections
 * left empty. Unavailable pages that are NOT hidden stay, dimmed by the caller.
 */
export function filterHubSections(
  sections: readonly HubSection[],
  input: HubVisibilityInput
): HubVisibilityResult {
  let hiddenCount = 0
  const visible: HubSection[] = []
  for (const section of sections) {
    const items = section.items.filter((item) => {
      if (!isHubItemHidden(item, input)) return true
      hiddenCount += 1
      return input.showHidden
    })
    if (items.length > 0) visible.push({ ...section, items })
  }
  return { sections: visible, hiddenCount }
}
