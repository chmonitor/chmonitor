/**
 * Renders the `suggest_dashboard` tool's output — a proposed dashboard layout
 * built from registry charts (plan 59). Recommend-only: this component never
 * saves anything by itself. "Apply to dashboard" loads the layout into the
 * dashboard route's unsaved working grid (the same sessionStorage bridge the
 * arrange-mode grid already uses — see `DASHBOARD_SESSION_KEY`) and navigates
 * there client-side, so it applies without a full page reload. The user still
 * has to use the existing save action in `SavedDashboardsToolbar` to persist
 * it — this widget never calls `saveDashboard()`.
 */

import { CheckIcon, LayoutDashboardIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

import type { DashboardLayout } from '@/types/dashboard-layout'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DASHBOARD_SESSION_KEY } from '@/lib/dashboard-storage'
import { useHostId } from '@/lib/swr'

export interface AgentDashboardSuggestionProps {
  request: string
  name: string
  layout: DashboardLayout
  chartCount: number
}

function humanizeChartName(chartName: string): string {
  return chartName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function AgentDashboardSuggestion({
  name,
  layout,
  chartCount,
}: AgentDashboardSuggestionProps) {
  const navigate = useNavigate()
  const hostId = useHostId()
  const [applied, setApplied] = useState(false)

  if (chartCount === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
        No registry charts matched this request.
      </div>
    )
  }

  const handleApply = () => {
    sessionStorage.setItem(DASHBOARD_SESSION_KEY, JSON.stringify(layout))
    setApplied(true)
    navigate({ to: '/dashboard', search: { host: hostId } })
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <LayoutDashboardIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{name}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {chartCount} chart{chartCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {layout.widgets.map((widget) => (
          <Badge key={widget.id} variant="outline" className="text-[11px]">
            {widget.chartName
              ? humanizeChartName(widget.chartName)
              : widget.type}
          </Badge>
        ))}
      </div>

      <div className="mt-3 border-t border-border/50 pt-2">
        <Button
          type="button"
          size="sm"
          variant={applied ? 'secondary' : 'default'}
          onClick={handleApply}
        >
          {applied ? (
            <>
              <CheckIcon className="size-3.5" /> Applied — open dashboard
            </>
          ) : (
            'Apply to dashboard'
          )}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Loads into the dashboard builder for review — you still choose when to
          save it.
        </p>
      </div>
    </div>
  )
}
