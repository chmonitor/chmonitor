import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  CircleDollarSign,
  Database,
  Gauge,
  HardDrive,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'

import type {
  InsightCard as InsightCardData,
  InsightSeverity,
} from '@/lib/insights/types'

import { useMemo, useState } from 'react'
import { InsightCard } from '@/components/insights/insight-card'
import { InsightsEmptyCta } from '@/components/insights/insights-empty-cta'
import {
  SEVERITY_META,
  SEVERITY_ORDER,
} from '@/components/insights/severity-meta'
import { AppLink } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  INSIGHTS_BACKEND_LABELS,
  useInsightsBackend,
} from '@/lib/hooks/use-insights-backend'
import { useInsights } from '@/lib/query/use-insights'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface InsightsPanelProps {
  hostId: number
  className?: string
}

/** Display metadata per insight category. Unknown categories fall back to a
 * title-cased label with the generic Sparkles icon. */
const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  anomaly: { label: 'Anomalies', icon: Activity },
  performance: { label: 'Performance', icon: Gauge },
  storage: { label: 'Storage', icon: HardDrive },
  reliability: { label: 'Reliability', icon: ShieldAlert },
  queries: { label: 'Queries', icon: Search },
  cost: { label: 'Cost', icon: CircleDollarSign },
}

function categoryMeta(category: string): { label: string; icon: LucideIcon } {
  return (
    CATEGORY_META[category] ?? {
      label: category.charAt(0).toUpperCase() + category.slice(1),
      icon: Sparkles,
    }
  )
}

const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/** Special filter ids that are not categories. */
const FILTER_ALL = 'all'
const FILTER_ATTENTION = 'attention'

/**
 * Classified AI insights board for the full `/insights` page. Insights are
 * grouped by category with section headers, filterable via a tab row, and the
 * critical/warning ones are surfaced through a dedicated "Needs attention" tab
 * plus the severity-toned accent on each card. Generated + cached server-side
 * (findings store); regenerate on demand and dismiss per-user (localStorage).
 */
export function InsightsPanel({ hostId, className }: InsightsPanelProps) {
  const {
    insights,
    counts,
    isLoading,
    isGenerating,
    refresh,
    generate,
    dismiss,
    dismissAll,
  } = useInsights(hostId)
  const [filter, setFilter] = useState<string>(FILTER_ALL)

  const hasInsights = insights.length > 0
  const attentionCount = counts.critical + counts.warning

  // Group by category, most-severe category first, then largest.
  const categories = useMemo(() => {
    const byCat = new Map<string, InsightCardData[]>()
    for (const insight of insights) {
      const arr = byCat.get(insight.category) ?? []
      arr.push(insight)
      byCat.set(insight.category, arr)
    }
    return [...byCat.entries()]
      .map(([category, items]) => ({
        category,
        items: [...items].sort(
          (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
        ),
        topRank: Math.min(...items.map((i) => SEVERITY_RANK[i.severity])),
      }))
      .sort((a, b) => a.topRank - b.topRank || b.items.length - a.items.length)
  }, [insights])

  // Empty + idle → slim CTA row, so the panel never shows an empty box.
  if (!hasInsights && !isLoading) {
    return (
      <InsightsEmptyCta
        hostId={hostId}
        isGenerating={isGenerating}
        onGenerate={generate}
        className={className}
      />
    )
  }

  // A selected category (or attention) can vanish after dismissals — fall back
  // to "All" so the board never shows an empty filtered view by accident.
  const categoryIds = new Set(categories.map((c) => c.category))
  let activeFilter = filter
  if (filter === FILTER_ATTENTION && attentionCount === 0)
    activeFilter = FILTER_ALL
  else if (
    filter !== FILTER_ALL &&
    filter !== FILTER_ATTENTION &&
    !categoryIds.has(filter)
  )
    activeFilter = FILTER_ALL

  const attentionItems = insights.filter((i) => i.severity !== 'info')

  return (
    <section
      className={cn('flex flex-col gap-3', className)}
      aria-label="AI insights"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">AI Insights</h2>
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] > 0 ? (
              <Badge
                key={sev}
                variant="outline"
                className={cn(
                  'text-[10px] font-medium',
                  SEVERITY_META[sev].badge
                )}
              >
                {counts[sev]} {SEVERITY_META[sev].label.toLowerCase()}
              </Badge>
            ) : null
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              generate()
              refresh()
            }}
            disabled={isGenerating}
          >
            <RefreshCw
              className={cn('size-3.5', isGenerating && 'animate-spin')}
            />
            {isGenerating ? 'Refreshing…' : 'Refresh'}
          </Button>
          {hasInsights ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={dismissAll}
            >
              <X className="size-3.5" />
              Dismiss all
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="AI Insights settings"
            asChild
          >
            <AppLink href={buildUrl('/insights-settings', { host: hostId })}>
              <Settings2 className="size-3.5" />
            </AppLink>
          </Button>
        </div>
      </div>

      {isLoading && !hasInsights ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <FilterTabs
            total={insights.length}
            attentionCount={attentionCount}
            categories={categories}
            active={activeFilter}
            onChange={setFilter}
          />

          {activeFilter === FILTER_ALL ? (
            <div className="flex flex-col gap-4">
              {categories.map(({ category, items }) => (
                <CategorySection
                  key={category}
                  category={category}
                  items={items}
                  hostId={hostId}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          ) : activeFilter === FILTER_ATTENTION ? (
            <InsightsGrid
              items={attentionItems}
              hostId={hostId}
              onDismiss={dismiss}
            />
          ) : (
            <InsightsGrid
              items={
                categories.find((c) => c.category === activeFilter)?.items ?? []
              }
              hostId={hostId}
              onDismiss={dismiss}
            />
          )}

          <InsightsStorageFooter hostId={hostId} />
        </>
      )}
    </section>
  )
}

interface CategoryGroup {
  category: string
  items: InsightCardData[]
  topRank: number
}

/** Segmented filter row: All · Needs attention · one tab per category. */
function FilterTabs({
  total,
  attentionCount,
  categories,
  active,
  onChange,
}: {
  total: number
  attentionCount: number
  categories: CategoryGroup[]
  active: string
  onChange: (id: string) => void
}) {
  const base =
    'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors'
  const activeCls = 'border-transparent bg-foreground text-background'
  const inactiveCls =
    'border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Filter insights"
    >
      <FilterTab
        label="All"
        count={total}
        selected={active === FILTER_ALL}
        onClick={() => onChange(FILTER_ALL)}
        className={cn(base, active === FILTER_ALL ? activeCls : inactiveCls)}
      />
      {attentionCount > 0 ? (
        <FilterTab
          label="Needs attention"
          count={attentionCount}
          icon={<TriangleAlert className="size-3.5" />}
          selected={active === FILTER_ATTENTION}
          onClick={() => onChange(FILTER_ATTENTION)}
          className={cn(
            base,
            active === FILTER_ATTENTION
              ? 'border-transparent bg-amber-500 text-white dark:bg-amber-600'
              : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-400'
          )}
        />
      ) : null}
      {categories.map(({ category, items }) => {
        const meta = categoryMeta(category)
        const Icon = meta.icon
        return (
          <FilterTab
            key={category}
            label={meta.label}
            count={items.length}
            icon={<Icon className="size-3.5" strokeWidth={1.5} />}
            selected={active === category}
            onClick={() => onChange(category)}
            className={cn(base, active === category ? activeCls : inactiveCls)}
          />
        )
      })}
    </div>
  )
}

function FilterTab({
  label,
  count,
  icon,
  selected,
  onClick,
  className,
}: {
  label: string
  count: number
  icon?: React.ReactNode
  selected: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={className}
    >
      {icon}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}

/** One category's header + card grid, used in the grouped "All" view. */
function CategorySection({
  category,
  items,
  hostId,
  onDismiss,
}: {
  category: string
  items: InsightCardData[]
  hostId: number
  onDismiss: (insight: InsightCardData) => void
}) {
  const meta = categoryMeta(category)
  const Icon = meta.icon
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" strokeWidth={1.5} />
        {meta.label}
        <span className="tabular-nums text-muted-foreground/70">
          {items.length}
        </span>
      </div>
      <InsightsGrid items={items} hostId={hostId} onDismiss={onDismiss} />
    </div>
  )
}

function InsightsGrid({
  items,
  hostId,
  onDismiss,
}: {
  items: InsightCardData[]
  hostId: number
  onDismiss: (insight: InsightCardData) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((insight) => (
        <InsightCard
          key={insight.key}
          insight={insight}
          hostId={hostId}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  )
}

/**
 * Footer showing where insights are persisted and a direct link to the settings
 * page. The backend is fixed at deploy time, so the storage label is read-only;
 * the "Configure" link gives users a path to tune generation preferences.
 */
function InsightsStorageFooter({ hostId }: { hostId: number }) {
  const { backend, isLoading } = useInsightsBackend()
  if (isLoading) return null

  return (
    <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
      <Database className="size-3 shrink-0" />
      <span>
        Stored in {INSIGHTS_BACKEND_LABELS[backend]} · refreshed automatically
      </span>
      <span aria-hidden="true">·</span>
      <AppLink
        href={buildUrl('/insights-settings', { host: hostId })}
        className="underline-offset-2 hover:text-foreground hover:underline"
      >
        Configure
      </AppLink>
    </p>
  )
}
