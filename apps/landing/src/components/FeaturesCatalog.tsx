import { Search } from 'lucide-react'

import type { ChangelogFeatureGroup } from '@/lib/parse-changelog-features'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { scopeChipLabel } from '@/lib/parse-changelog-features'
import { cn } from '@/lib/utils'
import '@/styles/globals.css'

type Props = {
  groups: ChangelogFeatureGroup[]
  totalCount: number
}

function ScopeChip({
  active,
  label,
  title,
  count,
  onClick,
}: {
  active: boolean
  label: string
  title: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 max-w-[9.5rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined ? (
        <span
          className={cn(
            'tabular-nums text-[10px]',
            active ? 'text-primary-foreground/80' : 'text-muted-foreground/80'
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

export default function FeaturesCatalog({ groups, totalCount }: Props) {
  const [query, setQuery] = useState('')
  const [activeScope, setActiveScope] = useState<string | null>(null)

  const scopes = useMemo(() => groups.map((g) => g.scope), [groups])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .filter((g) => !activeScope || g.scope === activeScope)
      .map((g) => ({
        ...g,
        features: g.features.filter((f) => {
          if (!q) return true
          return (
            f.title.toLowerCase().includes(q) ||
            f.scope.toLowerCase().includes(q) ||
            (f.version?.toLowerCase().includes(q) ?? false)
          )
        }),
      }))
      .filter((g) => g.features.length > 0)
  }, [groups, query, activeScope])

  const visibleCount = filtered.reduce((n, g) => n + g.features.length, 0)

  return (
    <section
      id="ship-log"
      className="py-12 sm:py-16"
      data-feature-count={totalCount}
      data-features-catalog
    >
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-balance font-semibold text-2xl tracking-tight sm:text-3xl">
            Shipped features
          </h2>
          <p className="mt-2 text-pretty text-muted-foreground text-sm sm:text-base">
            Grouped by scope from CHANGELOG.md.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter features…"
              className="pl-9"
              aria-label="Filter changelog features"
            />
          </div>
          <p className="text-muted-foreground text-sm tabular-nums">
            Showing {visibleCount} of {totalCount}
          </p>
        </div>

        <div
          className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="toolbar"
          aria-label="Filter by scope"
        >
          <ScopeChip
            active={activeScope === null}
            label="All"
            title="All scopes"
            count={totalCount}
            onClick={() => setActiveScope(null)}
          />
          {scopes.map((scope) => {
            const group = groups.find((g) => g.scope === scope)
            return (
              <ScopeChip
                key={scope}
                active={activeScope === scope}
                label={scopeChipLabel(scope)}
                title={scope}
                count={group?.features.length}
                onClick={() =>
                  setActiveScope(activeScope === scope ? null : scope)
                }
              />
            )
          })}
        </div>

        <ScrollArea className="mt-8 max-h-[70vh] pr-2">
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((group) => (
              <Card key={group.scope}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="truncate font-mono text-sm">
                      {group.scope}
                    </span>
                    <Badge
                      variant="secondary"
                      className="shrink-0 tabular-nums"
                    >
                      {group.features.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0 pb-4">
                  {group.features.map((feature, i) => (
                    <div key={`${feature.title}-${feature.version ?? i}`}>
                      {i > 0 ? <Separator className="my-2" /> : null}
                      <p className="text-foreground text-sm leading-snug">
                        {feature.title}
                      </p>
                      {feature.version ? (
                        <p className="mt-0.5 text-muted-foreground text-xs">
                          v{feature.version}
                          {feature.issue ? ` · #${feature.issue}` : ''}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </div>
    </section>
  )
}
