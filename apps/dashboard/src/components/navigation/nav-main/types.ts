import type { HTMLAttributes, ReactNode, Ref } from 'react'
import type {
  MenuItem as MenuItemType,
  MenuSection,
} from '@/components/menu/types'

/** `footer` items render in AppSidebar, so SectionLabelMap needs no "Footer" label. */
export type NavRenderSection = Exclude<MenuSection, 'footer'>

export interface MenuItemProps {
  item: MenuItemType
  pathname: string
  /** Optional props for the outer `li` (favorites drag reorder). */
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> }
  /** Optional hover control (favorites drag handle). */
  leadingAction?: ReactNode
}

export interface MenuGroupProps {
  section: NavRenderSection
  items: MenuItemType[]
  pathname: string
}

export interface NavMainProps {
  items: MenuItemType[]
}

export interface MenuItemActiveState {
  isActive: boolean
  hasActiveChild: boolean
}

export type SectionLabelMap = Record<NavRenderSection, string>
