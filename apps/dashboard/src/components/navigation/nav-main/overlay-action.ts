/**
 * Row action that stays visible on the touch overlay sidebar (below `lg`,
 * where there is no hover) and is hover/focus-revealed on the docked rail.
 * Replaces `SidebarMenuAction`'s `showOnHover`, whose `md:opacity-0` hid
 * the action on 768-1023 tablets. The 44px `after` hit area is overlay-only.
 */
export const overlayActionClasses =
  'after:-inset-3 md:after:block lg:after:hidden lg:opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 aria-expanded:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground'
