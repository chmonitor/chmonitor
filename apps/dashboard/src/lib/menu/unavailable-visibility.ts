import type { MenuItem } from '@/components/menu/types'

/**
 * Sidebar visibility of a page that is not fully available on this host
 * (issue #3463). One decision, three render sites: the expanded rail's leaf
 * row, the expanded rail's sub-item row, and the collapsed flyout row.
 *
 * There are two classes of "unavailable", and they are NOT the same call:
 *
 * 1. **Structurally impossible** — the item declares `tableCheck` and the
 *    backing system table is missing (or unreadable) on this host. The page
 *    can never work here, so a greyed row is pure noise. Hidden.
 * 2. **Not configured, but enableable** — the item declares
 *    `requiresMetadataDb` and the deployment has no D1/Postgres. The operator
 *    can turn this on, so hiding it would delete the discovery path for a
 *    feature that ships in the box. Dimmed, unless the item opts in with
 *    `hideWhenUnavailable`.
 *
 * The global Settings → Navigation → *Unavailable pages* toggle overrides the
 * class rule: `dimUnavailablePages: true` means Dim for everything, so anyone
 * who prefers discoverability gets every row back.
 */

/** The fields of a `MenuItem` this policy reads. */
export type UnavailabilityItem = Pick<
  MenuItem,
  'tableCheck' | 'requiresMetadataDb' | 'hideWhenUnavailable'
>

/** Everything the policy needs besides the item itself. */
export interface UnavailableState {
  /** The item's `tableCheck` table is readable on this host (fail-open). */
  tableAvailable: boolean
  /** The deployment has the metadata DB a `requiresMetadataDb` item needs. */
  metadataDbSatisfied: boolean
  /**
   * The shared availability map is still in flight. A row is never hidden from
   * an unsettled map — see {@link unavailableVisibility}.
   */
  availabilityLoading: boolean
  /** Settings → Navigation → *Unavailable pages*: `true` = Dim, `false` = Hide. */
  dimUnavailablePages: boolean
}

export type UnavailableVisibility = 'available' | 'dimmed' | 'hidden'

/** The full resolution for one item: the verdict plus the signals behind it. */
export interface UnavailableResolution {
  visibility: UnavailableVisibility
  tableAvailable: boolean
  metadataDbSatisfied: boolean
}

/**
 * Whether this item drops out of the menu when it is unavailable, under the
 * default Hide setting.
 *
 * A `tableCheck` item is class 1 and hides. A config-gated item is class 2 and
 * dims. `hideWhenUnavailable` overrides both directions: `true` hides a
 * config-gated item, `false` keeps a `tableCheck` item discoverable.
 */
export function hidesWhenUnavailable(item: UnavailabilityItem): boolean {
  if (item.hideWhenUnavailable !== undefined) {
    return item.hideWhenUnavailable
  }
  return Boolean(item.tableCheck)
}

/**
 * Resolve one item's rail visibility. The only place that decision is made.
 *
 * @param item - The menu item being rendered
 * @param state - Host availability, config, load state, and the user setting
 */
export function resolveUnavailable(
  item: UnavailabilityItem,
  state: UnavailableState
): UnavailableResolution {
  const { tableAvailable, metadataDbSatisfied } = state

  if (tableAvailable && metadataDbSatisfied) {
    return { visibility: 'available', tableAvailable, metadataDbSatisfied }
  }

  // Never hide from a map that has not settled. `useIsTableAvailable` is
  // fail-open, so an in-flight map already reads as available and this branch
  // is belt-and-braces — it is stated here anyway so the decision site owns the
  // contract instead of inheriting it from the map. Reversing it would be
  // worse, not better: the common case is a host where everything IS available,
  // and hiding-while-loading would make every such page flash in and out on
  // every mount, versus one settled removal for the few that genuinely cannot
  // run.
  const visibility: UnavailableVisibility = state.availabilityLoading
    ? 'available'
    : state.dimUnavailablePages
      ? 'dimmed'
      : hidesWhenUnavailable(item)
        ? 'hidden'
        : 'dimmed'

  return { visibility, tableAvailable, metadataDbSatisfied }
}

/**
 * The one sentence to show on a dimmed row's tooltip / `title`, or `null` when
 * the row is fully available. Both nav surfaces read the copy from here so the
 * expanded rail and the collapsed flyout cannot drift apart.
 */
export function unavailableReasonText(
  resolution: UnavailableResolution
): string | null {
  if (resolution.visibility === 'available') return null
  if (!resolution.tableAvailable) return 'System table not found on this host'
  if (!resolution.metadataDbSatisfied) {
    return 'Requires a metadata database — configure D1 or Postgres'
  }
  return null
}

/**
 * Drop every `hidden` item from a catalog, and any parent left empty by that
 * removal — the same empty-parent rule as `filterCloudOnly` /
 * `filterHiddenMenuHrefs`, so a group whose children all vanish never renders
 * as a heading with a dangling chevron.
 *
 * `visibilityOf` is injected because the host signals are hooks: the caller
 * reads the shared availability map ONCE and resolves the whole catalog against
 * it, rather than one hook per row.
 */
export function filterUnavailableVisibility(
  items: readonly MenuItem[],
  visibilityOf: (item: MenuItem) => UnavailableVisibility
): MenuItem[] {
  return items.flatMap((item) => {
    if (visibilityOf(item) === 'hidden') return []

    if (!item.items) return [{ ...item }]

    const childItems = filterUnavailableVisibility(item.items, visibilityOf)
    if (childItems.length === 0) return []

    return [{ ...item, items: childItems }]
  })
}
