import { ChevronRight, Loader2 } from 'lucide-react'

import type { ComponentType } from 'react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface TreeNodeProps {
  label: string
  icon?: ComponentType<{ className?: string }>
  iconClassName?: string // Custom class for icon styling (e.g., engine-specific colors)
  iconTooltip?: string // Optional tooltip for the icon
  isExpanded?: boolean
  isSelected?: boolean
  isHighlighted?: boolean // Parent highlight (e.g., database when table is selected)
  isLoading?: boolean
  hasChildren?: boolean
  expandOnSelect?: boolean // If true, clicking label expands node (default: true for backwards compat)
  level: number
  badge?: React.ReactNode
  onToggle?: () => void
  onSelect?: () => void
  children?: React.ReactNode
}

export const TreeNode = function TreeNode({
  label,
  icon: Icon,
  iconClassName,
  iconTooltip,
  isExpanded = false,
  isSelected = false,
  isHighlighted = false,
  isLoading = false,
  hasChildren = false,
  expandOnSelect = true,
  level,
  badge,
  onToggle,
  onSelect,
  children,
}: TreeNodeProps) {
  const paddingLeft = level * 12

  return (
    // SidebarMenuItem (<li>) must be the direct child of its SidebarMenu (<ul>),
    // so the Collapsible wrapper lives *inside* the <li> — which also gives the
    // tree its correct semantics (a node's nested <ul> sits within its <li>).
    <SidebarMenuItem
      className={cn(
        'transition-colors',
        isHighlighted && !isSelected && 'bg-sidebar-accent/50'
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <div
          className="flex items-center gap-1"
          style={{ paddingLeft: `${paddingLeft}px` }}
        >
          {hasChildren && (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
                className="flex size-4 items-center justify-center rounded-sm hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                {isLoading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ChevronRight
                    className={cn(
                      'size-3 transition-transform',
                      isExpanded && 'rotate-90'
                    )}
                  />
                )}
              </button>
            </CollapsibleTrigger>
          )}
          {!hasChildren && <div className="size-4" />}

          <SidebarMenuButton
            onClick={() => {
              // If expandOnSelect is true and has children and not expanded, expand first
              if (expandOnSelect && hasChildren && !isExpanded) {
                onToggle?.()
              }
              onSelect?.()
            }}
            isActive={isSelected}
            className={cn(
              'flex-1 justify-start',
              isHighlighted && !isSelected && 'font-medium'
            )}
          >
            {Icon &&
              (iconTooltip ? (
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Icon
                      className={cn(
                        'size-4 shrink-0',
                        isHighlighted && 'text-primary',
                        iconClassName
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {iconTooltip}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Icon
                  className={cn(
                    'size-4 shrink-0',
                    isHighlighted && 'text-primary',
                    iconClassName
                  )}
                />
              ))}
            {/* `truncate` clips visually via CSS ellipsis while keeping the
                full name in the DOM; `select-text` keeps it double-click
                selectable + copyable even inside this clickable button. */}
            <span className="truncate select-text">{label}</span>
            {badge && <div className="ml-auto">{badge}</div>}
          </SidebarMenuButton>
        </div>

        {hasChildren && children && (
          <CollapsibleContent>
            <SidebarMenuSub>{children}</SidebarMenuSub>
          </CollapsibleContent>
        )}
      </Collapsible>
    </SidebarMenuItem>
  )
}
