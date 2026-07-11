import type {
  MenuItem as MenuItemType,
  MenuSection,
} from '@/components/menu/types'

/**
 * Sections NavMain renders as labelled groups in the sidebar body. `footer`
 * items are rendered separately in the sidebar footer (see AppSidebar), so they
 * are excluded here — that keeps {@link SectionLabelMap} exhaustive without a
 * (never-shown) "Footer" label.
 */
export type NavRenderSection = Exclude<MenuSection, 'footer'>

/**
 * Props for rendering a single menu item
 */
export interface MenuItemProps {
  /** The menu item to render */
  item: MenuItemType
  /** Current pathname for active state detection */
  pathname: string
}

/**
 * Props for rendering a menu group (section with collapsible items)
 */
export interface MenuGroupProps {
  /** Section identifier */
  section: NavRenderSection
  /** Items in this section */
  items: MenuItemType[]
  /** Current pathname for active state detection */
  pathname: string
}

/**
 * Props for the main navigation component
 */
export interface NavMainProps {
  /** All menu items (across all sections) */
  items: MenuItemType[]
}

/**
 * Internal state for menu item active detection
 */
export interface MenuItemActiveState {
  /** Whether the item itself is active */
  isActive: boolean
  /** Whether any child item is active */
  hasActiveChild: boolean
}

/**
 * Section label mapping
 */
export type SectionLabelMap = Record<NavRenderSection, string>
