import { LayoutGridIcon } from 'lucide-react'

import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'
import type { ComponentType } from 'react'
import type { ChartProps } from '@/components/charts/chart-props'
import type { MenuItem } from '@/components/menu/types'

import { memo, Suspense } from 'react'
import { CountBadge } from '@/components/menu/components/count-badge'
import { PagePinToggle } from '@/components/menu/components/page-pin-toggle'
import { useUnavailableResolver } from '@/components/menu/hooks/use-unavailable-visibility'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { ChartSkeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/ui/empty-state'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { findHubGroup, getHubSections } from '@/lib/menu/hub'
import { unavailableReasonText } from '@/lib/menu/unavailable-visibility'
import { getAllowedMenuItems } from '@/lib/menu/visible-items'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

export interface HubChartConfig {
  id: string
  component: ComponentType<ChartProps>
  title: string
  href: string
  lastHours?: number
  interval?: ClickHouseInterval
}

// 1 column at phone width, 2 at md, 4 at xl — the same fixed row height the
// overview grid uses so every ChartCard fills its cell.
const HUB_CHART_GRID_CLASS =
  'grid auto-rows-[260px] grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4 min-w-0'

const HUB_CARD_GRID_CLASS =
  'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'

const HubChart = memo(function HubChart({
  chart,
  hostId,
}: {
  chart: HubChartConfig
  hostId: number
}) {
  const ChartComponent = chart.component
  return (
    <Suspense fallback={<ChartSkeleton title={chart.title} />}>
      <ChartComponent
        title={chart.title}
        href={chart.href}
        lastHours={chart.lastHours}
        interval={chart.interval}
        className="h-full w-full"
        chartClassName="h-full min-h-0 w-full"
        chartCardContentClassName="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-0"
        hostId={hostId}
      />
    </Suspense>
  )
})

function HubLinkCard({
  item,
  reason,
}: {
  item: MenuItem
  /** Why the page is unavailable on this host; null when it is available. */
  reason: string | null
}) {
  const Icon = item.icon
  return (
    <div className="group/card relative">
      <HostPrefixedLink
        href={item.href}
        title={reason ?? undefined}
        className={cn(
          'group flex h-full min-h-11 items-start gap-3 rounded-lg border bg-card p-3 pr-11 transition-colors pointer-coarse:pr-14',
          'hover:border-foreground/20 hover:bg-accent/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          reason && 'opacity-50'
        )}
      >
        {Icon ? (
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            {item.countKey ? (
              <span className="ml-auto flex shrink-0">
                <CountBadge
                  countKey={item.countKey}
                  countLabel={item.countLabel}
                  countVariant={item.countVariant}
                />
              </span>
            ) : null}
          </span>
          {item.description || reason ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {reason ?? item.description}
            </span>
          ) : null}
        </span>
      </HostPrefixedLink>
      <PagePinToggle
        href={item.href}
        title={item.title}
        className="absolute top-1.5 right-1.5 size-8 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:size-11"
        unpinnedClassName="pointer-fine:opacity-0 pointer-fine:group-hover/card:opacity-100 pointer-fine:group-focus-within/card:opacity-100"
      />
    </div>
  )
}

/**
 * The hub is the group's index: every page the deployment allows is listed,
 * including pages hidden from the sidebar. Only a page that cannot run on this
 * host is dimmed, with its reason.
 */
function HubSections({ group, hostId }: { group: MenuItem; hostId: number }) {
  const resolve = useUnavailableResolver(hostId)

  return (
    <div className="flex flex-col gap-6">
      {getHubSections(group).map((section) => (
        <section
          key={section.name}
          aria-labelledby={`hub-section-${section.name}`}
          className="flex flex-col gap-2"
        >
          <h2
            id={`hub-section-${section.name}`}
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {section.name}
          </h2>
          <div className={HUB_CARD_GRID_CLASS}>
            {section.items.map((item) => (
              <HubLinkCard
                key={item.href}
                item={item}
                reason={unavailableReasonText(resolve(item))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function HubPage({
  hubHref,
  charts,
}: {
  hubHref: string
  charts: HubChartConfig[]
}) {
  const hostId = useHostId()
  const engine = useActiveHostEngine()
  const { config } = useFeaturePermissions()
  // Deployment gates (permissions, cloud-only, engine) apply exactly as in
  // the sidebar, so the hub never links to a page the rail would not offer.
  const group = findHubGroup(hubHref, getAllowedMenuItems(config, engine))

  if (!group) {
    return (
      <EmptyState
        variant="no-data"
        title="Nothing to show here"
        description="None of the pages in this group are enabled for this deployment or host."
        icon={
          <LayoutGridIcon
            className="h-10 w-10 text-muted-foreground/60"
            strokeWidth={1.5}
          />
        }
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="sr-only">{group.title}</h1>
      {charts.length > 0 ? (
        <div
          className={HUB_CHART_GRID_CLASS}
          role="region"
          aria-label={`${group.title} key charts`}
        >
          {charts.map((chart) => (
            <HubChart key={chart.id} chart={chart} hostId={hostId} />
          ))}
        </div>
      ) : null}
      <HubSections group={group} hostId={hostId} />
    </div>
  )
}
